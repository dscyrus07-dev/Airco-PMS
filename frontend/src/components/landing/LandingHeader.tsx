import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Operations', href: '#operations' },
  { label: 'Properties', href: '#properties' },
  { label: 'About', href: '#about' },
];

export const LandingHeader: React.FC = () => {
  const { navigate } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-[#F7F4EE]/90 backdrop-blur-sm border-b border-[#EAE5DC]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 cursor-pointer"
          aria-label="Management Tool home"
        >
          <span className="w-8 h-8 rounded-[9px] bg-[#386641] text-white flex items-center justify-center font-display font-bold text-sm">
            MT
          </span>
          <span className="font-display font-semibold text-[15px] text-[#24221F] tracking-tight">
            Management Tool
          </span>
        </button>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="px-3 py-1.5 text-sm font-medium text-[#555047] hover:text-[#24221F] rounded-[8px] hover:bg-[#F0EBE2] transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            Login
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/signup')}>
            Get Started
          </Button>
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden p-2 text-[#555047] hover:text-[#24221F] cursor-pointer"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav
          className="md:hidden border-t border-[#EAE5DC] bg-[#F7F4EE] px-4 py-3 space-y-1"
          aria-label="Mobile"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block px-3 py-2 text-sm font-medium text-[#555047] rounded-[8px] hover:bg-[#F0EBE2]"
            >
              {link.label}
            </a>
          ))}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => navigate('/login')}
            >
              Login
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => navigate('/signup')}
            >
              Get Started
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
};
