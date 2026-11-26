import { describe, expect, it } from 'vitest';
import { sanitiseSvg } from '../src/views/score/sanitise';

describe('sanitiseSvg', () => {
  it('keeps ordinary engraved SVG as it is', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="note" id="n1"><use xlink:href="#E0A4"/><text>Für Elise</text></g></svg>';
    expect(sanitiseSvg(svg)).toBe(svg);
  });

  it('removes scripts, event handlers and script URLs', () => {
    const dirty =
      '<svg onload="alert(1)"><script>alert(2)</script><g onclick=\'x()\'><a href="javascript:alert(3)">t</a><use xlink:href="data:text/html,x"/></g></svg>';
    const clean = sanitiseSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|javascript:|data:text/i);
    expect(clean).toContain('<svg');
  });

  it('removes foreign content and cannot be rebuilt from split tags', () => {
    expect(sanitiseSvg('<svg><foreignObject><iframe src="x"></iframe></foreignObject></svg>')).toBe(
      '<svg></svg>',
    );
    expect(
      sanitiseSvg('<svg><scr<script></script>ipt>alert(1)</scr<script></script>ipt></svg>'),
    ).not.toMatch(/<script/i);
  });

  it('leaves nothing blocked behind deeply nested constructions', () => {
    // Removing the inner element or attribute rebuilds the outer one, one layer per pass. A loop
    // with a fixed pass count left the outer layers standing (CodeQL js/incomplete-multi-character-
    // sanitization).
    const layers = 20;
    let element = '<script></script>';
    for (let i = 0; i < layers; i += 1) {
      element = `<scr${element}ipt></script>`;
    }
    expect(sanitiseSvg(`<svg>${element}</svg>`)).toBe('<svg></svg>');
  });

  it('removes handlers and links behind other separators and spellings', () => {
    const dirty = [
      '<svg/onload=alert(1)></svg>',
      '<svg a="b"onload=alert(1)></svg>',
      "<svg a='b'ONLOAD = 'alert(1)'></svg>",
      '<svg><a href=javascript:alert(1)>t</a></svg>',
      '<svg><a href="java&#x73;cript:alert(1)">t</a></svg>',
      '<svg><a HREF="https://example.org/">t</a></svg>',
      "<svg><a xlink:href='vbscript:x'>t</a></svg>",
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
      '<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>',
    ];
    for (const svg of dirty) {
      expect(sanitiseSvg(svg), svg).not.toMatch(
        /\son[a-z]+\s*=|[/"']on[a-z]+\s*=|href|<set|<animate/i,
      );
    }
    // Links inside the drawing stay.
    const inner = '<svg><use xlink:href="#E0A4"/><use href=\'#x\'/></svg>';
    expect(sanitiseSvg(inner)).toBe(inner);
  });

  it('is fast on long runs of white space and quotes', () => {
    const t0 = performance.now();
    sanitiseSvg(`<svg${' '.repeat(200_000)}>`);
    sanitiseSvg(`<svg ${'a="'.repeat(50_000)}>`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
