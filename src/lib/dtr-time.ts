export const ATTENDANCE_TIME_ZONE = "Asia/Manila";

export function attendanceDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function attendanceMonth() {
  return Number(attendanceDate().slice(5, 7)) - 1;
}

export function attendanceYear() {
  return Number(attendanceDate().slice(0, 4));
}
