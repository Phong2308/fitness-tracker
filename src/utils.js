"use strict";

// utils — extracted from the working app; public function names preserved.

function htmlText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}
function getTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function getDateKey(date = getTodayDate()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getDayName(date = getTodayDate()) {
  const map = {
    0: "CN",
    1: "T2",
    2: "T3",
    3: "T4",
    4: "T5",
    5: "T6",
    6: "T7"
  };
  return map[date.getDay()];
}
function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function parseWeekNumber(value) {
  const match = String(value ?? "").match(/(\d+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
function normalizeDay(day) {
  if (!day) return "";
  const text = String(day).toLowerCase().trim().replace("ứ", "u").replace("ă", "a");
  const map = {
    "thu 2": "T2",
    "thu2": "T2",
    "t2": "T2",
    "thu 3": "T3",
    "thu3": "T3",
    "t3": "T3",
    "thu 4": "T4",
    "thu4": "T4",
    "t4": "T4",
    "thu 5": "T5",
    "thu5": "T5",
    "t5": "T5",
    "thu 6": "T6",
    "thu6": "T6",
    "t6": "T6",
    "thu 7": "T7",
    "thu7": "T7",
    "t7": "T7",
    "chu nhat": "CN",
    "cn": "CN"
  };
  return map[text] || text;
}

