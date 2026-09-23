/**
 * Armenian-aware text normalization for verbatim quote verification.
 * Standardizes Unicode NFC, collapses whitespace, lowers case,
 * and harmonizes Armenian and standard punctuation marks.
 */
export function normalizeArmenianText(text: string): string {
  if (!text) return '';

  return (
    text
      // 1. Unicode NFC normalization
      .normalize('NFC')
      // 2. Unify Armenian and standard punctuation marks
      // Armenian full stop (։ U+0589), Latin colon (:), period (.) -> unified placeholder or standard dot
      .replace(/[\u0589:\.]/g, ' . ')
      // Armenian comma (՝ U+055D), standard comma (,)
      .replace(/[\u055D,]/g, ' , ')
      // Armenian intonation marks (shesht ՛ U+055B, paruyk ՞ U+055E, batsaganchakan ՜ U+055C)
      // sit inside a word ("Ինչո՞ւ"), so they are dropped without splitting it
      .replace(/[\u055B\u055E\u055C]/g, '')
      .replace(/[!?]/g, ' ')
      // Armenian hyphen (֊ U+058A), standard hyphen (-)
      .replace(/[\u058A\u2010\u2011\u2012\u2013\u2014\-]/g, ' - ')
      // Quotation marks and apostrophes
      // (incl. Armenian apostrophe ՚ U+055A)
      .replace(/['"«»„“”’‘`ʻʼ\u055A]/g, "'")
      // 3. Lowercase (Armenian uppercase -> lowercase)
      .toLowerCase()
      // 3a. Ligature և (U+0587) and the spelling եւ are the same text in both orthographies
      .replace(/\u0587/g, '\u0565\u0582')
      // 4. Collapse whitespace (spaces, tabs, newlines, non-breaking spaces)
      .replace(/[\s\u00A0\u200B]+/g, ' ')
      .trim()
  );
}

/**
 * Checks whether quote is found verbatim inside chunk text after Armenian normalization.
 */
export function isQuoteVerbatimInChunk(quote: string, chunkText: string): boolean {
  if (!quote || !chunkText) return false;
  const normalizedQuote = normalizeArmenianText(quote);
  const normalizedChunk = normalizeArmenianText(chunkText);
  // A quote with no letters or digits (e.g. just "։") proves nothing
  if (!/[\p{L}\p{N}]/u.test(normalizedQuote)) return false;
  return normalizedChunk.includes(normalizedQuote);
}
