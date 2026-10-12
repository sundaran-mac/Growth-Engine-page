import nock from 'nock';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { extractKindFor, extractText, htmlToPlain, normaliseText } from './extract.js';
import { isPublicAddress, safeFetch, setResolverForTests } from './safe-fetch.js';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (addr) => {
    expect(isPublicAddress(addr)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8'])(
    'allows %s',
    (addr) => {
      expect(isPublicAddress(addr)).toBe(true);
    },
  );
});

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

describe('safeFetch', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });
  afterAll(() => {
    nock.enableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
    setResolverForTests(null);
  });

  it('blocks private and loopback literals and non-http schemes', async () => {
    await expectCode(safeFetch('http://127.0.0.1/admin'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('http://169.254.169.254/latest/meta-data'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('http://[::1]:8080/'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('http://10.0.0.5/'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('file:///etc/passwd'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('ftp://example.com/x'), 'URL_NOT_ALLOWED');
    await expectCode(safeFetch('http://user:pw@example.com/'), 'URL_NOT_ALLOWED');
  });

  it('blocks a host name that resolves to a private address', async () => {
    setResolverForTests(async () => [{ address: '192.168.0.10', family: 4 }]);
    await expectCode(safeFetch('http://intranet.example.com/'), 'URL_NOT_ALLOWED');
  });

  it('blocks when any of several addresses is private', async () => {
    setResolverForTests(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expectCode(safeFetch('http://mixed.example.com/'), 'URL_NOT_ALLOWED');
  });

  it('reports a host that does not resolve', async () => {
    setResolverForTests(async () => {
      throw new Error('ENOTFOUND');
    });
    await expectCode(safeFetch('http://nowhere.example.com/'), 'URL_NOT_REACHABLE');
  });

  it('fetches a public page and returns type and body', async () => {
    setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    nock('https://docs.example.com')
      .get('/about')
      .reply(200, '<h1>Hi</h1>', { 'Content-Type': 'text/html; charset=utf-8' });
    const res = await safeFetch('https://docs.example.com/about');
    expect(res.contentType).toBe('text/html');
    expect(res.body.toString()).toBe('<h1>Hi</h1>');
  });

  it('checks every redirect hop again', async () => {
    setResolverForTests(async (host) =>
      host === 'internal.example.com'
        ? [{ address: '10.0.0.2', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );
    nock('https://docs.example.com')
      .get('/r')
      .reply(302, '', { Location: 'http://internal.example.com/secret' });
    await expectCode(safeFetch('https://docs.example.com/r'), 'URL_NOT_ALLOWED');
  });

  it('follows a public redirect', async () => {
    setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    nock('https://docs.example.com').get('/old').reply(301, '', { Location: '/new' });
    nock('https://docs.example.com').get('/new').reply(200, 'ok', { 'Content-Type': 'text/plain' });
    const res = await safeFetch('https://docs.example.com/old');
    expect(res.url).toBe('https://docs.example.com/new');
    expect(res.body.toString()).toBe('ok');
  });

  it('stops at the size limit', async () => {
    setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    nock('https://docs.example.com')
      .get('/big')
      .reply(200, 'x'.repeat(2000), { 'Content-Type': 'text/plain' });
    await expectCode(
      safeFetch('https://docs.example.com/big', { maxBytes: 1000 }),
      'URL_TOO_LARGE',
    );
  });

  it('times out a slow page', async () => {
    setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    nock('https://docs.example.com').get('/slow').delay(500).reply(200, 'late');
    await expectCode(safeFetch('https://docs.example.com/slow', { timeoutMs: 100 }), 'URL_TIMEOUT');
  });

  it('reports a non-2xx answer', async () => {
    setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    nock('https://docs.example.com').get('/gone').reply(404, 'no');
    await expectCode(safeFetch('https://docs.example.com/gone'), 'URL_NOT_REACHABLE');
  });
});

describe('extract', () => {
  it('picks the extractor by mime type, then by name', () => {
    expect(extractKindFor('application/pdf')).toBe('pdf');
    expect(
      extractKindFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(extractKindFor('text/html')).toBe('html');
    expect(extractKindFor('text/markdown')).toBe('text');
    expect(extractKindFor(null, 'notes.md')).toBe('text');
    expect(extractKindFor('application/octet-stream', 'spec.pdf')).toBe('pdf');
    expect(extractKindFor('image/png', 'a.png')).toBeNull();
  });

  it('strips html to text without scripts, styles or images', () => {
    const text = htmlToPlain(
      '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>Hello <a href="https://x">world</a></p><img src="a.png"></body></html>',
    );
    expect(text).toContain('Hello world');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('https://x');
  });

  it('normalises blank lines and caps length', () => {
    expect(normaliseText('a  \r\n\n\n\nb')).toBe('a\n\nb');
    expect(normaliseText('x'.repeat(250_000))).toHaveLength(200_000);
  });

  it('reads markdown as is and refuses empty text', async () => {
    await expect(extractText(Buffer.from('# Spec\n\nHearts are counted.'), 'text')).resolves.toBe(
      '# Spec\n\nHearts are counted.',
    );
    await expectCode(extractText(Buffer.from('   '), 'text'), 'DOCUMENT_EMPTY');
  });

  it('reads text from a PDF', async () => {
    await expect(extractText(minimalPdf('Hearts are counted'), 'pdf')).resolves.toContain(
      'Hearts are counted',
    );
  });

  it('reports an unreadable PDF or DOCX', async () => {
    await expectCode(extractText(Buffer.from('not a pdf'), 'pdf'), 'DOCUMENT_UNREADABLE');
    await expectCode(extractText(Buffer.from('not a zip'), 'docx'), 'DOCUMENT_UNREADABLE');
  });
});

/** One-page PDF with a single line of text (offsets computed so the xref table is valid). */
function minimalPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 20 60 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
