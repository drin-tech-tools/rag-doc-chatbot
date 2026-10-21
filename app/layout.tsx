import "./globals.css";
export const metadata = { title: "RAG Doc Chatbot", description: "Chat with your PDFs, with citations" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
