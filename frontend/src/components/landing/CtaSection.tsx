import React from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';

export const CtaSection: React.FC = () => {
  const { navigate } = useApp();

  return (
    <section className="px-4 sm:px-6 py-14">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-[18px] border border-[#EAE5DC] px-6 sm:px-12 py-10 sm:py-14 text-center">
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-[#24221F] tracking-tight">
            Bring your properties and operations into one workspace.
          </h2>
          <p className="font-body text-sm sm:text-[15px] text-[#6C675F] mt-3 max-w-xl mx-auto leading-relaxed">
            Start building a more connected operational system for your organization.
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
      </div>
    </section>
  );
};
