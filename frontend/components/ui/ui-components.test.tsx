// =============================================================================
// Snapshot tests de los componentes UI base
// =============================================================================
// Protegen el markup de Button, Input, Alert y Skeleton ante rediseños: si el
// futuro cambio de estilo (dark-first) altera la estructura sin querer, el
// snapshot lo detecta. Los snapshots se actualizan con `npm test -- -u` solo
// cuando el cambio es intencional.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Button } from './button';
import { Input } from './input';
import { Alert } from './alert';
import { Skeleton } from './skeleton';

describe('UI components (snapshot)', () => {
  it('Button: variantes y carga', () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primario</Button>
        <Button variant="secondary">Secundario</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Peligro</Button>
        <Button isLoading>Cargando</Button>
        <Button size="sm">Chico</Button>
      </div>,
    );
    expect(container).toMatchSnapshot();
  });

  it('Input: normal, con error y disabled', () => {
    const { container } = render(
      <div>
        <Input placeholder="Normal" />
        <Input placeholder="Con error" error="Campo requerido" />
        <Input placeholder="Deshabilitado" disabled />
      </div>,
    );
    expect(container).toMatchSnapshot();
  });

  it('Alert: error, success e info', () => {
    const { container } = render(
      <div>
        <Alert variant="error">Algo salió mal</Alert>
        <Alert variant="success">Todo bien</Alert>
        <Alert variant="info">Información</Alert>
      </div>,
    );
    expect(container).toMatchSnapshot();
  });

  it('Skeleton: base y con tamaño', () => {
    const { container } = render(
      <div>
        <Skeleton />
        <Skeleton className="h-40 w-64" />
      </div>,
    );
    expect(container).toMatchSnapshot();
  });
});
