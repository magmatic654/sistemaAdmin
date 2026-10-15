import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Administración · Llantera', description: 'Entradas, salidas y comisiones de la llantera.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
