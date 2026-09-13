const DEFAULT_MAX_LENGTH = 512;
interface BertTokenizerJson {
  model?: {
    type?: string;
    vocab?: Record<string, number>;
    unk_token?: string;
    continuing_subword_prefix?: string;
    max_input_chars_per_word?: number;
  };
  truncation?: {
    max_length?: number;
  } | null;
}

export interface EncodedBatch {
  attentionMask: BigInt64Array<ArrayBuffer>;
  inputIds: BigInt64Array<ArrayBuffer>;
  tokenTypeIds: BigInt64Array<ArrayBuffer>;
  dimensions: [number, number];
}

export class BertWordPieceTokenizer {
  private readonly continuationPrefix: string;
  private readonly maxInputCharactersPerWord: number;
  private readonly maxLength: number;
  private readonly clsId: number;
  private readonly padId: number;
  private readonly sepId: number;
  private readonly unknownId: number;
  private readonly vocabulary: Map<string, number>;

  get maximumSequenceLength(): number {
    return this.maxLength;
  }

  constructor(definition: string | BertTokenizerJson) {
    const parsed = typeof definition === 'string'
      ? JSON.parse(definition) as BertTokenizerJson
      : definition;
    if (parsed.model?.type !== 'WordPiece' || !parsed.model.vocab) {
      throw new Error('The on-device tokenizer is not a supported WordPiece definition.');
    }
    const unknownToken = parsed.model.unk_token ?? '[UNK]';
    const unknownId = parsed.model.vocab[unknownToken];
    if (!Number.isSafeInteger(unknownId)) {
      throw new Error('The on-device tokenizer does not define its unknown token.');
    }
    const clsId = parsed.model.vocab['[CLS]'];
    const sepId = parsed.model.vocab['[SEP]'];
    const padId = parsed.model.vocab['[PAD]'];
    if (![clsId, sepId, padId].every(Number.isSafeInteger)) {
      throw new Error('The on-device tokenizer does not define its required special tokens.');
    }

    this.clsId = clsId as number;
    this.continuationPrefix = parsed.model.continuing_subword_prefix ?? '##';
    this.maxInputCharactersPerWord = parsed.model.max_input_chars_per_word ?? 100;
    this.maxLength = Math.max(2, Math.floor(parsed.truncation?.max_length ?? DEFAULT_MAX_LENGTH));
    this.padId = padId as number;
    this.sepId = sepId as number;
    this.unknownId = unknownId as number;
    this.vocabulary = new Map(Object.entries(parsed.model.vocab));
  }

  encode(text: string): number[] {
    const content = this.wordPieceTokens(basicTokens(text));
    return [this.clsId, ...content.slice(0, this.maxLength - 2), this.sepId];
  }

  encodeChunks(text: string, maxChunks: number): number[][] {
    const content = this.wordPieceTokens(basicTokens(text));
    const contentLength = this.maxLength - 2;
    const safeMaxChunks = Math.max(1, Math.floor(maxChunks));
    if (content.length === 0) return [[this.clsId, this.sepId]];
    const chunks: number[][] = [];
    for (let offset = 0; offset < content.length && chunks.length < safeMaxChunks; offset += contentLength) {
      chunks.push([this.clsId, ...content.slice(offset, offset + contentLength), this.sepId]);
    }
    return chunks;
  }

  encodeBatch(texts: string[]): EncodedBatch {
    if (texts.length === 0) throw new Error('Cannot embed an empty text batch.');
    return this.padSequences(texts.map((text) => this.encode(text)));
  }

  padSequences(sequences: number[][]): EncodedBatch {
    if (sequences.length === 0) throw new Error('Cannot embed an empty token batch.');
    if (sequences.some((ids) => ids.length < 2 || ids.length > this.maxLength)) {
      throw new Error('The on-device tokenizer received an invalid token sequence.');
    }
    const sequenceLength = Math.max(...sequences.map((ids) => ids.length));
    const elementCount = sequences.length * sequenceLength;
    const inputIds = new BigInt64Array(elementCount);
    const attentionMask = new BigInt64Array(elementCount);
    const tokenTypeIds = new BigInt64Array(elementCount);

    for (let row = 0; row < sequences.length; row += 1) {
      const ids = sequences[row] ?? [];
      for (let column = 0; column < sequenceLength; column += 1) {
        const offset = row * sequenceLength + column;
        const id = ids[column] ?? this.padId;
        inputIds[offset] = BigInt(id);
        attentionMask[offset] = column < ids.length ? 1n : 0n;
      }
    }

    return {
      attentionMask,
      dimensions: [sequences.length, sequenceLength],
      inputIds,
      tokenTypeIds,
    };
  }

  private wordPieceTokens(tokens: string[]): number[] {
    const ids: number[] = [];
    for (const token of tokens) {
      const characters = [...token];
      if (characters.length > this.maxInputCharactersPerWord) {
        ids.push(this.unknownId);
        continue;
      }

      const pieces: number[] = [];
      let start = 0;
      let failed = false;
      while (start < characters.length) {
        let end = characters.length;
        let matchedId: number | undefined;
        while (start < end) {
          const value = `${start === 0 ? '' : this.continuationPrefix}${characters.slice(start, end).join('')}`;
          matchedId = this.vocabulary.get(value);
          if (matchedId !== undefined) break;
          end -= 1;
        }
        if (matchedId === undefined) {
          failed = true;
          break;
        }
        pieces.push(matchedId);
        start = end;
      }
      ids.push(...(failed ? [this.unknownId] : pieces));
    }
    return ids;
  }
}

function basicTokens(source: string): string[] {
  const cleaned = cleanText(tokenizeChineseCharacters(source));
  const normalized = cleaned.toLocaleLowerCase('en-US').normalize('NFD').replace(/\p{Mark}/gu, '');
  const tokens: string[] = [];
  for (const word of normalized.trim().split(/\s+/u)) {
    if (!word) continue;
    let current = '';
    for (const character of word) {
      if (isPunctuation(character)) {
        if (current) tokens.push(current);
        tokens.push(character);
        current = '';
      } else {
        current += character;
      }
    }
    if (current) tokens.push(current);
  }
  return tokens;
}

function cleanText(source: string): string {
  let output = '';
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0 || code === 0xfffd || isControl(character)) continue;
    output += isWhitespace(character) ? ' ' : character;
  }
  return output;
}

function tokenizeChineseCharacters(source: string): string {
  let output = '';
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0;
    output += isChineseCharacter(code) ? ` ${character} ` : character;
  }
  return output;
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || /^\p{Separator}$/u.test(character);
}

function isControl(character: string): boolean {
  if (character === '\t' || character === '\n' || character === '\r') return false;
  return /^[\p{Cc}\p{Cf}]$/u.test(character);
}

function isPunctuation(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 33 && code <= 47)
    || (code >= 58 && code <= 64)
    || (code >= 91 && code <= 96)
    || (code >= 123 && code <= 126)
    || /^\p{Punctuation}$/u.test(character);
}

function isChineseCharacter(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x20000 && code <= 0x2a6df)
    || (code >= 0x2a700 && code <= 0x2b73f)
    || (code >= 0x2b740 && code <= 0x2b81f)
    || (code >= 0x2b820 && code <= 0x2ceaf)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x2f800 && code <= 0x2fa1f);
}
