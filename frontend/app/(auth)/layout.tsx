import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gray-50">
      <Link href="/" className="mb-8 text-2xl font-semibold text-gray-900">
        Inventario<span className="text-accent-600">Pro</span>
      </Link>
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  );
}
