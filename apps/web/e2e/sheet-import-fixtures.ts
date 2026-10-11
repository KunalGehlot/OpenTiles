// Files for the e2e tests, generated here (CC0): no third-party score or PDF is ever used.

/** A one-track MIDI file: C4 D4 E4 F4 as quarter notes, one bar of 4/4. */
export function tinyMidi(): Buffer {
  const events: number[] = [];
  [60, 62, 64, 65].forEach((p) => {
    events.push(0, 0x90, p, 80, 0x83, 0x60, 0x80, p, 0);
  });
  events.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = events.length;
  return Buffer.from([...header, 0x4d, 0x54, 0x72, 0x6b, 0, 0, len >> 8, len & 0xff, ...events]);
}

/**
 * A valid one-page PDF with an empty staff drawn as an engraver would: five lines and four bars,
 * all straight path segments (`m`/`l`). The cross-reference offsets are counted, not typed in, so
 * PDF readers open it without repairing it.
 */
export function tinyPdf(): Buffer {
  const left = 72;
  const right = 540;
  const top = 700;
  const lines = [0, 1, 2, 3, 4].map((i) => `${left} ${top - 8 * i} m ${right} ${top - 8 * i} l S`);
  const bars = [0, 1, 2, 3, 4].map((i) => {
    const x = left + ((right - left) / 4) * i;
    return `${x} ${top} m ${x} ${top - 32} l S`;
  });
  const content = ['0.8 w', ...lines, '1.6 w', ...bars].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
