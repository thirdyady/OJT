import { supabase } from "@/integrations/supabase/client";

// Use a unique cursor and continue until an empty page. Do not assume the
// deployment's PostgREST row limit matches our requested page size.
async function allPages<T extends { id: string }>(
  page: (after: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const result = await page(after);
    if (result.error) throw result.error;
    if (!result.data?.length) return rows;
    rows.push(...result.data);
    const next = result.data[result.data.length - 1].id;
    if (next === after) throw new Error("Record loading did not advance. Please reload.");
    after = next;
  }
}

export async function loadDtrRows(userId: string) {
  const rows = await allPages((after) => {
    let query = supabase
      .from("dtr_entries")
      .select("id, user_id, entry_date, check_in, break_out, break_in, check_out")
      .eq("user_id", userId)
      .order("id")
      .limit(500);
    if (after) query = query.gt("id", after);
    return query;
  });
  return rows.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

export async function loadProfiles() {
  const rows = await allPages((after) => {
    let query = supabase
      .from("profiles")
      .select(
        "id, full_name, student_id, company, ojt_title, required_ojt_hours, is_admin, is_active, updated_at",
      )
      .order("id")
      .limit(500);
    if (after) query = query.gt("id", after);
    return query;
  });
  return rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}
