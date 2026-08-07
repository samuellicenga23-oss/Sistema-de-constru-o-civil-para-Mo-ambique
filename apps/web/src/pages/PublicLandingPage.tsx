import { LandingHeader } from "../components/landing/LandingHeader";
import { Hero } from "../components/landing/Hero";
import { FeatureGrid } from "../components/landing/FeatureGrid";
import { ProductTabs } from "../components/landing/ProductTabs";
import { Roles } from "../components/landing/Roles";
import { SuppliersSection } from "../components/landing/SuppliersSection";
import { Pricing } from "../components/landing/Pricing";
import { Faq } from "../components/landing/Faq";
import { ContactCTA } from "../components/landing/ContactCTA";
import { SiteFooter } from "../components/landing/SiteFooter";

/** Landing pública — design Magic Patterns, ligada às rotas e contactos reais do SIGO. */
export default function PublicLandingPage() {
  return (
    <div className="sigo-atmosphere min-h-screen w-full">
      <LandingHeader />
      <main>
        <Hero />
        <FeatureGrid />
        <ProductTabs />
        <Roles />
        <SuppliersSection />
        <Pricing />
        <Faq />
        <ContactCTA />
      </main>
      <SiteFooter />
    </div>
  );
}
