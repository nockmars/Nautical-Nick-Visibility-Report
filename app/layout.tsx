import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nautical Nick — San Diego Spearfishing Visibility",
  description: "Daily ocean visibility forecasts for San Diego dive spots.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-nn-bg text-nn-text font-body antialiased">
        {children}
      </body>
    </html>
  );
}
