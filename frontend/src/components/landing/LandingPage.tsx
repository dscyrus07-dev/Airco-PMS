import React from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { LandingHeader } from './LandingHeader';
import { HeroSection } from './HeroSection';
import { FeaturesSection } from './FeaturesSection';
import { OperationsSection } from './OperationsSection';
import { RolesSection } from './RolesSection';
import { CtaSection } from './CtaSection';
import { LandingFooter } from './LandingFooter';

/**
 * Public landing page — the entry point for unauthenticated visitors.
 * Authenticated users skip straight to their role's workspace.
 */
export const LandingPage: React.FC = () => {
  const { isAuthenticated, currentUser } = useApp();

  if (isAuthenticated && currentUser) {
    if (currentUser.role === 'super_admin') return <Navigate to="/admin/properties" replace />;
    if (currentUser.role === 'property_manager')
      return <Navigate to={`/property/${currentUser.property_uid}/zones`} replace />;
    return <Navigate to="/employee/tasks" replace />;
  }

  return (
    <div className="min-h-screen bg-[#F7F4EE]">
      <LandingHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <OperationsSection />
        <RolesSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
};
