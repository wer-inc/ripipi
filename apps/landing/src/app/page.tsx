import Hero from '@/components/Hero';
import ValueProposition from '@/components/ValueProposition';
import Features from '@/components/Features';
import Screenshots from '@/components/Screenshots';
import ROICalculator from '@/components/ROICalculator';
import Process from '@/components/Process';
import Pricing from '@/components/Pricing';
import FAQ from '@/components/FAQ';
import DemoForm from '@/components/DemoForm';
import FixedHeader from '@/components/FixedHeader';

export default function Home() {
  return (
    <>
      <FixedHeader />
      <main className="min-h-screen">
        <Hero />
        <ValueProposition />
        <Features />
        <Screenshots />
        <ROICalculator />
        <Process />
        <Pricing />
        <FAQ />
        <DemoForm />
      </main>
    </>
  );
}