import { parseEnvironment } from '@/lib/config/environment';

export default function HomePage() {
  parseEnvironment(process.env);
  return (
    <main>
      <p className="eyebrow">BAZAK / COMMERCE LAB</p>
      <h1>A thoughtful way<br />to find your next favorite.</h1>
      <p className="intro">A conversational shopping experience, grounded in the catalog.</p>
      <section aria-labelledby="progress-title">
        <span className="badge">Development preview</span>
        <h2 id="progress-title">The foundation is taking shape.</h2>
        <p>Product discovery and the shopping conversation are coming next. This preview does not yet provide recommendations.</p>
      </section>
      <footer>Bazak AI Agent Commerce · Assignment prototype</footer>
    </main>
  );
}
