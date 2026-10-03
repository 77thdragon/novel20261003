// 画面で使うライブラリ（すべてローカルの node_modules から読み込む）
export {
  h, html, render, createContext, useState, useReducer, useEffect, useLayoutEffect,
  useRef, useMemo, useCallback, useContext,
} from '/vendor/htm/preact/standalone.module.js';
import { marked } from '/vendor/marked/lib/marked.esm.js';
import DOMPurify from '/vendor/dompurify/dist/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

export function mdToHtml(md) {
  return DOMPurify.sanitize(marked.parse(String(md ?? '')));
}
