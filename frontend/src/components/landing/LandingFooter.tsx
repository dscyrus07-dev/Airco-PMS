import React from 'react';

const FOOTER_COLS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Properties', href: '#properties' },
      { label: 'Operations', href: '#operations' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Contact', href: '#contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', href: '#privacy' },
      { label: 'Terms', href: '#terms' },
    ],
  },
];

export const LandingFooter: React.FC = () => {
  return (
    <footer className="border-t border-[#EAE5DC] bg-[#F2EEE7]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-[8px] bg-[#386641] text-white flex items-center justify-center font-display font-bold text-xs">
                MT
              </span>
              <span className="font-display font-semibold text-sm text-[#24221F]">
                Management Tool
              </span>
            </div>
            <p className="font-body text-xs text-[#8C867C] mt-2.5 leading-relaxed">
              Property &amp; Operations Management
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <p className="text-[11px] font-semibold text-[#45413B] uppercase tracking-wider mb-2.5">
                {col.heading}
              </p>
              <ul className="space-y-1.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-[13px] text-[#6C675F] hover:text-[#24221F] transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-t border-[#E2DDD5] mt-8 pt-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-[11px] text-[#8C867C] font-body">
            © {new Date().getFullYear()} Management Tool. All rights reserved.
          </p>
          <p className="text-[11px] text-[#B4ACA0] font-body">
            Built for hospitality operations teams.
          </p>
        </div>
      </div>
    </footer>
  );
};
