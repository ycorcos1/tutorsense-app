import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TutorSense",
  description: "Tutor performance scoring dashboard",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="min-h-dvh bg-gray-50 text-gray-900 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
