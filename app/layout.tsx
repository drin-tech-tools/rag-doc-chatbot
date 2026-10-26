import "./globals.css";
import { AuthUrlHandler } from "@/app/components/AuthUrlHandler";

export const metadata = { title: "RAG Doc Chatbot", description: "Chat with your PDFs, with citations" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthUrlHandler />
        {children}
      </body>
    </html>
  );
}
