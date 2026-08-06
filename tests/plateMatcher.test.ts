import { extractBestPlate } from '../src/analysis/plateMatcher';

describe('extractBestPlate — Indian plate format matching from OCR text', () => {
  it('extracts a clean plate with no noise', () => {
    const m = extractBestPlate(['KA05MH1234']);
    expect(m).not.toBeNull();
    expect(m!.plate).toBe('KA05MH1234');
    expect(m!.stateCode).toBe('KA');
    expect(m!.rtoCode).toBe('05');
    expect(m!.seriesCode).toBe('MH');
    expect(m!.uniqueNumber).toBe('1234');
  });

  it('tolerates spaces and dashes between groups', () => {
    expect(extractBestPlate(['MH 12 KR 1145'])!.plate).toBe('MH12KR1145');
    expect(extractBestPlate(['MH-12-KR-1145'])!.plate).toBe('MH12KR1145');
  });

  it('finds a plate embedded in surrounding watermark text', () => {
    const m = extractBestPlate(['KARNATAKA INDIA PUTTUR DAKSHINA KANNADA 574210 KA05MH1234 MORE TEXT']);
    expect(m!.plate).toBe('KA05MH1234');
  });

  it('corrects letter-for-digit OCR confusion (I instead of 1)', () => {
    expect(extractBestPlate(['MH12KR1I45'])!.plate).toBe('MH12KR1145');
  });

  it('corrects digit-for-letter OCR confusion (OS instead of 05)', () => {
    expect(extractBestPlate(['KAOSMH1234'])!.plate).toBe('KA05MH1234');
  });

  it('drops stray OCR noise characters inside the plate string', () => {
    expect(extractBestPlate(['MH12N7W8556'])!.plate).toBe('MH12NW8556');
  });

  it('pads a single-digit RTO code', () => {
    expect(extractBestPlate(['KA5MH1234'])!.plate).toBe('KA05MH1234');
  });

  it('joins a plate split across two OCR lines', () => {
    const m = extractBestPlate(['MH 12', 'KR 1145']);
    expect(m!.plate).toBe('MH12KR1145');
  });

  it('handles an IND tag next to the plate', () => {
    expect(extractBestPlate(['IND MH12KR1145'])!.plate).toBe('MH12KR1145');
  });

  it('prefers the cleaner candidate when several plates are present', () => {
    const m = extractBestPlate(['TN0SBT5754 MH12KR1145']);
    expect(m!.plate).toBe('MH12KR1145');
  });

  it('returns null when no Indian plate format is present', () => {
    expect(extractBestPlate(['Hello world this is just some random text 12345'])).toBeNull();
    expect(extractBestPlate([''])).toBeNull();
  });

  it('supports varied series lengths and three-digit numbers', () => {
    const m = extractBestPlate(['KA05MH123'])!;
    expect(m.plate).toBe('KA05MH123');
    expect(m.seriesCode).toBe('MH');
    expect(m.uniqueNumber).toBe('123');
  });
});
