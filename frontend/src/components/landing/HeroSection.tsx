import React from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { ProductPreview } from './ProductPreview';

export const HeroSection: React.FC = () => {
  const { navigate } = useApp();

  return (
    <section className="px-4 sm:px-6 pt-14 sm:pt-20 pb-12">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-[11px] font-semibold text-[#386641] uppercase tracking-[0.18em] font-body">
            Property Operations, Simplified
          </p>
          <h1 className="font-display font-bold text-3xl sm:text-4xl lg:text-[42px] leading-[1.15] text-[#24221F] tracking-tight mt-4">
            One workspace for every property operation.
          </h1>
          <p className="font-body text-[15px] sm:text-base text-[#6C675F] leading-relaxed mt-4 max-w-xl mx-auto">
            Manage properties, teams, rooms and daily operations from one connected
            platform built for modern hospitality businesses.
          </p>
          <div className="flex items-center justify-center gap-3 mt-7">
            <Button variant="primary" size="lg" onClick={() => navigate('/signup')}>
              Get Started
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate('/login')}>
              Login
            </Button>
          </div>
        </div>

        {/* Product preview */}
        <div id="properties" className="mt-12 sm:mt-16 scroll-mt-20">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
};
