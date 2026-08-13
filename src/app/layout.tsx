import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NehsaMUD",
  description:
    "A text-based world you explore by typing where you want to go.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="page">
          <main id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
