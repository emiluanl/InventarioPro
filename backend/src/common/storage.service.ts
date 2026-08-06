// =============================================================================
// StorageService - abstracción de almacenamiento de archivos
// =============================================================================
// Dos implementaciones seleccionables por env var STORAGE_PROVIDER:
//
//   - 'local':  guarda en el directorio LOCAL_UPLOAD_DIR (por defecto ./uploads).
//               Útil para desarrollo. NO escalar a producción: el backend se
//               vuelve con estado y los archivos se pierden al redeploy.
//
//   - 'supabase': usa Supabase Storage vía cliente @supabase/supabase-js.
//                 Requiere SUPABASE_URL, SUPABASE_SERVICE_KEY y SUPABASE_BUCKET.
//
// En la fase 4, los productos suben fotos y recibos. El service decide qué
// implementación usar una sola vez en el constructor.
// =============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface UploadResult {
  url: string; // URL pública (local: /uploads/<archivo>; supabase: URL firmada)
  key: string; // Identificador interno
  size_bytes: number;
  mime_type: string;
  nombre: string;
}

export interface FileInput {
  buffer: Buffer;
  mime_type: string;
  original_name: string;
}

export interface IStorageProvider {
  upload(folder: string, file: FileInput): Promise<UploadResult>;
  delete(key: string): Promise<void>;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'];

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: IStorageProvider;
  private readonly providerName: 'local' | 'supabase';

  constructor(private readonly config: ConfigService) {
    this.providerName = (config.get<string>('STORAGE_PROVIDER') as 'local' | 'supabase') ?? 'local';

    if (this.providerName === 'supabase') {
      this.provider = new SupabaseStorageProvider(config);
    } else {
      this.provider = new LocalStorageProvider(config);
    }

    this.logger.log(`Storage provider activo: ${this.providerName}`);
  }

  /**
   * Valida MIME/extensión/tamaño antes de subir. Lanza BadRequestException
   * si algo falla.
   */
  validateFile(file: FileInput): void {
    if (!ALLOWED_MIME.includes(file.mime_type)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${file.mime_type}. Permitidos: ${ALLOWED_MIME.join(', ')}`,
      );
    }
    const ext = path.extname(file.original_name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      throw new BadRequestException(`Extensión no permitida: ${ext}.`);
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `Archivo demasiado grande: ${(file.buffer.length / 1024 / 1024).toFixed(2)} MB. Máximo: 5 MB.`,
      );
    }
  }

  async upload(folder: string, file: FileInput): Promise<UploadResult> {
    this.validateFile(file);
    return this.provider.upload(folder, file);
  }

  async delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }
}

// =============================================================================
// LocalStorageProvider - escribe en disco
// =============================================================================

class LocalStorageProvider implements IStorageProvider {
  private readonly uploadDir: string;
  private readonly publicPrefix = '/uploads';

  constructor(private readonly config: ConfigService) {
    const dir = this.config.get<string>('LOCAL_UPLOAD_DIR') ?? './uploads';
    this.uploadDir = path.resolve(dir);
    fs.mkdir(this.uploadDir, { recursive: true }).catch(() => undefined);
  }

  async upload(folder: string, file: FileInput): Promise<UploadResult> {
    const ext = path.extname(file.original_name);
    const filename = `${folder}-${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    const fullPath = path.join(this.uploadDir, folder, filename);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    return {
      url: `${this.publicPrefix}/${folder}/${filename}`,
      key: `${folder}/${filename}`,
      size_bytes: file.buffer.length,
      mime_type: file.mime_type,
      nombre: file.original_name,
    };
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.uploadDir, key);
    try {
      await fs.unlink(fullPath);
    } catch (err) {
      // Si no existe, lo consideramos éxito (idempotente).
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

// =============================================================================
// SupabaseStorageProvider - sube al bucket de Supabase
// =============================================================================

class SupabaseStorageProvider implements IStorageProvider {
  private client: import('@supabase/supabase-js').SupabaseClient | null = null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('SUPABASE_BUCKET') ?? 'inventariopro';
  }

  private getClient(): import('@supabase/supabase-js').SupabaseClient {
    if (this.client) return this.client;
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_KEY');
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL y SUPABASE_SERVICE_KEY son obligatorios para STORAGE_PROVIDER=supabase.',
      );
    }
    // Import dinámico para no forzar la dependencia si no se usa.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('@supabase/supabase-js');
    const created = createClient(url, key, { auth: { persistSession: false } });
    this.client = created;
    return created;
  }

  async upload(folder: string, file: FileInput): Promise<UploadResult> {
    const client = this.getClient();
    const ext = path.extname(file.original_name);
    const filename = `${folder}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;

    const { error } = await client.storage
      .from(this.bucket)
      .upload(filename, file.buffer, { contentType: file.mime_type, upsert: false });

    if (error) {
      throw new BadRequestException(`Error subiendo a Supabase: ${error.message}`);
    }

    const { data: signed } = await client.storage
      .from(this.bucket)
      .createSignedUrl(filename, 60 * 60 * 24 * 365); // 1 año

    return {
      url: signed?.signedUrl ?? `${this.bucket}/${filename}`,
      key: filename,
      size_bytes: file.buffer.length,
      mime_type: file.mime_type,
      nombre: file.original_name,
    };
  }

  async delete(key: string): Promise<void> {
    const client = this.getClient();
    await client.storage.from(this.bucket).remove([key]);
  }
}
