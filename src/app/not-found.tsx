import Link from "next/link";
export default function NotFound() {
  return (
    <div className="page-heading">
      <h1>Page not found</h1>
      <Link href="/">Return to Gap Scanner</Link>
    </div>
  );
}
