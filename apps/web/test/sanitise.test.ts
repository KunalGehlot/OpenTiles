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
});
