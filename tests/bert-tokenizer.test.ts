import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BertWordPieceTokenizer } from '../src/on-device/bert-tokenizer';

const tokenizer = new BertWordPieceTokenizer(readFileSync(
  resolve(import.meta.dirname, '../research/on-device-embeddings/results/tokenizer-fixture.json'),
  'utf8',
));

describe('BertWordPieceTokenizer', () => {
  it.each([
    ['Hello, world!', [101, 7592, 1010, 2088, 999, 102]],
    ['reducing coordination overhead', [101, 8161, 12016, 8964, 102]],
    ['Café naïve', [101, 7668, 15743, 102]],
    ['unaffordablely', [101, 14477, 4246, 8551, 3085, 2135, 102]],
    ['中文 test', [101, 1746, 1861, 3231, 102]],
  ])('matches the reviewed Transformers.js token IDs for %s', (text, expected) => {
    expect(tokenizer.encode(text)).toEqual(expected);
  });

  it('pads batches and creates int64 attention and token-type inputs', () => {
    const encoded = tokenizer.encodeBatch(['hello', 'hello world']);

    expect(encoded.dimensions).toEqual([2, 4]);
    expect([...encoded.inputIds]).toEqual([101n, 7592n, 102n, 0n, 101n, 7592n, 2088n, 102n]);
    expect([...encoded.attentionMask]).toEqual([1n, 1n, 1n, 0n, 1n, 1n, 1n, 1n]);
    expect([...encoded.tokenTypeIds]).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it('truncates content while preserving CLS and SEP', () => {
    const definition = {
      model: {
        continuing_subword_prefix: '##',
        max_input_chars_per_word: 100,
        type: 'WordPiece',
        unk_token: '[UNK]',
        vocab: { '[PAD]': 0, '[UNK]': 100, '[CLS]': 101, '[SEP]': 102, hello: 7592 },
      },
      truncation: { max_length: 5 },
    };
    const shortTokenizer = new BertWordPieceTokenizer(definition);

    expect(shortTokenizer.encode('hello hello hello hello hello')).toEqual([101, 7592, 7592, 7592, 102]);
  });

  it('splits long documents into bounded model-ready chunks in the worker tokenizer', () => {
    const definition = {
      model: {
        continuing_subword_prefix: '##',
        max_input_chars_per_word: 100,
        type: 'WordPiece',
        unk_token: '[UNK]',
        vocab: { '[PAD]': 0, '[UNK]': 100, '[CLS]': 101, '[SEP]': 102, hello: 7592 },
      },
      truncation: { max_length: 5 },
    };
    const shortTokenizer = new BertWordPieceTokenizer(definition);

    expect(shortTokenizer.encodeChunks('hello hello hello hello hello hello hello', 2)).toEqual([
      [101, 7592, 7592, 7592, 102],
      [101, 7592, 7592, 7592, 102],
    ]);
  });

  it('rejects empty batches and unsupported tokenizer definitions', () => {
    expect(() => tokenizer.encodeBatch([])).toThrow('empty text batch');
    expect(() => new BertWordPieceTokenizer({ model: { type: 'BPE' } })).toThrow('supported WordPiece');
  });
});
