'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Download, Copy, Check, Printer, Upload, X } from 'lucide-react';

type DotStyle = 'square' | 'rounded' | 'dots' | 'classy-rounded' | 'extra-rounded';
type CornerStyle = 'square' | 'extra-rounded' | 'dot';

interface QrOptions {
  dotStyle: DotStyle;
  fgColor: string;
  bgColor: string;
  cornerStyle: CornerStyle;
  logoDataUrl: string | null;
  logoSize: number;
}

const DOT_STYLES: { value: DotStyle; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy-rounded', label: 'Classy' },
  { value: 'extra-rounded', label: 'Smooth' },
];

const CORNER_STYLES: { value: CornerStyle; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'extra-rounded', label: 'Rounded' },
  { value: 'dot', label: 'Dot' },
];

const PRESETS: { label: string; opts: Partial<QrOptions> }[] = [
  { label: 'Default', opts: { fgColor: '#ffffff', bgColor: '#000000', dotStyle: 'square', cornerStyle: 'square' } },
  { label: 'Emerald', opts: { fgColor: '#4ade80', bgColor: '#000000', dotStyle: 'rounded', cornerStyle: 'extra-rounded' } },
  { label: 'Minimal', opts: { fgColor: '#000000', bgColor: '#ffffff', dotStyle: 'dots', cornerStyle: 'dot' } },
  { label: 'Classy', opts: { fgColor: '#e2e8f0', bgColor: '#0f172a', dotStyle: 'classy-rounded', cornerStyle: 'extra-rounded' } },
];

export function QrCustomizer({ payUrl, handle }: { payUrl: string; handle: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qrRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [opts, setOpts] = useState<QrOptions>({
    dotStyle: 'square',
    fgColor: '#ffffff',
    bgColor: '#000000',
    cornerStyle: 'square',
    logoDataUrl: null,
    logoSize: 0.25,
  });
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildConfig = useCallback((o: QrOptions): any => ({
    width: 300,
    height: 300,
    data: payUrl,
    margin: 16,
    qrOptions: { errorCorrectionLevel: (o.logoDataUrl ? 'H' : 'M') as 'H' | 'M' },
    dotsOptions: { type: o.dotStyle, color: o.fgColor },
    backgroundOptions: { color: o.bgColor },
    cornersSquareOptions: { type: o.cornerStyle === 'dot' ? 'dot' : o.cornerStyle, color: o.fgColor },
    cornersDotOptions: { color: o.fgColor },
    ...(o.logoDataUrl && {
      image: o.logoDataUrl,
      imageOptions: { crossOrigin: 'anonymous', margin: 4, imageSize: o.logoSize },
    }),
  }), [payUrl]);

  // Mount QR instance
  useEffect(() => {
    let mounted = true;
    import('qr-code-styling').then(({ default: QRCodeStyling }) => {
      if (!mounted || !containerRef.current) return;
      containerRef.current.innerHTML = '';
      qrRef.current = new QRCodeStyling(buildConfig(opts));
      qrRef.current.append(containerRef.current);
    });
    return () => { mounted = false; };
    // only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update QR when opts change
  useEffect(() => {
    if (qrRef.current) {
      qrRef.current.update(buildConfig(opts));
    }
  }, [opts, buildConfig]);

  function applyPreset(preset: Partial<QrOptions>) {
    setOpts((prev) => ({ ...prev, ...preset }));
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setOpts((prev) => ({ ...prev, logoDataUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function removeLogo() {
    setOpts((prev) => ({ ...prev, logoDataUrl: null }));
  }

  async function download(ext: 'png' | 'svg') {
    if (!qrRef.current) return;
    setDownloading(true);
    try {
      await qrRef.current.download({ name: `biashara-qr-${handle}`, extension: ext });
    } finally {
      setDownloading(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function print() {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>Biashara QR — @${handle}</title>
      <style>
        body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #fff; font-family: monospace; }
        img { width: 280px; height: 280px; }
        p { margin-top: 12px; font-size: 13px; color: #555; letter-spacing: 0.05em; }
        @media print { button { display: none; } }
      </style></head>
      <body>
        <img src="${dataUrl}" />
        <p>Pay @${handle} via nTZS</p>
        <p style="font-size:10px;color:#aaa;margin-top:4px;">${payUrl}</p>
        <button onclick="window.print()" style="margin-top:16px;padding:8px 20px;border:1px solid #ccc;background:#000;color:#fff;cursor:pointer;font-family:monospace;letter-spacing:0.1em;font-size:11px;text-transform:uppercase;">Print</button>
      </body></html>
    `);
    win.document.close();
  }

  return (
    <section className="relative border border-white/10 p-5 font-mono">
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/30" />

      <p className="text-[10px] tracking-widest text-white/30 uppercase mb-5">QR Code</p>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* Preview */}
        <div className="flex flex-col items-center gap-4 shrink-0">
          <div
            ref={containerRef}
            className="border border-white/10 overflow-hidden"
            style={{ width: 200, height: 200 }}
          />
          <p className="text-[10px] tracking-widest text-white/25 uppercase">@{handle}</p>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              onClick={() => download('png')}
              disabled={downloading}
              className="flex items-center gap-1.5 border border-white/10 px-3 py-1.5 text-[10px] tracking-wider text-white/40 uppercase hover:bg-white/5 hover:text-white/60 transition-colors disabled:opacity-30"
            >
              <Download size={10} />PNG
            </button>
            <button
              onClick={() => download('svg')}
              disabled={downloading}
              className="flex items-center gap-1.5 border border-white/10 px-3 py-1.5 text-[10px] tracking-wider text-white/40 uppercase hover:bg-white/5 hover:text-white/60 transition-colors disabled:opacity-30"
            >
              <Download size={10} />SVG
            </button>
            <button
              onClick={print}
              className="flex items-center gap-1.5 border border-white/10 px-3 py-1.5 text-[10px] tracking-wider text-white/40 uppercase hover:bg-white/5 hover:text-white/60 transition-colors"
            >
              <Printer size={10} />Print
            </button>
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[10px] tracking-wider text-emerald-400/70 uppercase hover:bg-emerald-500/15 transition-colors"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* Customization */}
        <div className="flex-1 space-y-5 min-w-0">

          {/* Presets */}
          <div>
            <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">Presets</p>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.opts)}
                  className="border border-white/10 py-1.5 text-[10px] text-white/40 uppercase hover:bg-white/5 hover:text-white/60 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dot style */}
          <div>
            <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">Dot Style</p>
            <div className="grid grid-cols-5 gap-1.5">
              {DOT_STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setOpts((o) => ({ ...o, dotStyle: s.value }))}
                  className={`border py-1.5 text-[10px] uppercase transition-colors ${
                    opts.dotStyle === s.value
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 text-white/35 hover:bg-white/5'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Corner style */}
          <div>
            <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">Corner Style</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CORNER_STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setOpts((o) => ({ ...o, cornerStyle: s.value }))}
                  className={`border py-1.5 text-[10px] uppercase transition-colors ${
                    opts.cornerStyle === s.value
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 text-white/35 hover:bg-white/5'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div className="flex gap-4">
            <div className="flex-1">
              <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">QR Color</p>
              <div className="flex items-center gap-2 border border-white/10 bg-black px-3 py-2">
                <input
                  type="color"
                  value={opts.fgColor}
                  onChange={(e) => setOpts((o) => ({ ...o, fgColor: e.target.value }))}
                  className="w-5 h-5 rounded-none border-0 bg-transparent cursor-pointer p-0"
                />
                <span className="text-xs text-white/40 font-mono">{opts.fgColor.toUpperCase()}</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">Background</p>
              <div className="flex items-center gap-2 border border-white/10 bg-black px-3 py-2">
                <input
                  type="color"
                  value={opts.bgColor}
                  onChange={(e) => setOpts((o) => ({ ...o, bgColor: e.target.value }))}
                  className="w-5 h-5 rounded-none border-0 bg-transparent cursor-pointer p-0"
                />
                <span className="text-xs text-white/40 font-mono">{opts.bgColor.toUpperCase()}</span>
              </div>
            </div>
          </div>

          {/* Logo upload */}
          <div>
            <p className="text-[10px] tracking-widest text-white/30 uppercase mb-2">Center Logo</p>
            {opts.logoDataUrl ? (
              <div className="flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-2">
                <img src={opts.logoDataUrl} alt="logo" className="w-8 h-8 object-contain" />
                <span className="flex-1 text-[10px] text-white/40 truncate">Logo uploaded</span>
                <button
                  onClick={removeLogo}
                  className="text-white/25 hover:text-rose-400 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 border border-dashed border-white/15 w-full px-4 py-3 text-[10px] tracking-wider text-white/25 uppercase hover:border-white/30 hover:text-white/40 transition-colors"
              >
                <Upload size={11} />
                Upload image (PNG, JPG, SVG)
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
            {opts.logoDataUrl && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] tracking-widest text-white/25 uppercase">Logo Size</p>
                  <span className="text-[10px] text-white/35">{Math.round(opts.logoSize * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.4}
                  step={0.05}
                  value={opts.logoSize}
                  onChange={(e) => setOpts((o) => ({ ...o, logoSize: Number(e.target.value) }))}
                  className="w-full accent-emerald-500"
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </section>
  );
}
