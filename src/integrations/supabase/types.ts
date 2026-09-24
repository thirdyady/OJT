export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      dtr_admin_audit: {
        Row: {
          action: string;
          actor_id: string;
          actor_name: string | null;
          affected_user: string | null;
          approval_method: string;
          created_at: string;
          dtr_id: string | null;
          entry_date: string | null;
          id: string;
          new_values: Json | null;
          old_values: Json | null;
          reason: string | null;
          request_id: string;
          ssp_version: number;
        };
        Insert: {
          action: string;
          actor_id: string;
          actor_name?: string | null;
          affected_user?: string | null;
          approval_method: string;
          created_at?: string;
          dtr_id?: string | null;
          entry_date?: string | null;
          id?: string;
          new_values?: Json | null;
          old_values?: Json | null;
          reason?: string | null;
          request_id: string;
          ssp_version: number;
        };
        Update: {
          action?: string;
          actor_id?: string;
          actor_name?: string | null;
          affected_user?: string | null;
          approval_method?: string;
          created_at?: string;
          dtr_id?: string | null;
          entry_date?: string | null;
          id?: string;
          new_values?: Json | null;
          old_values?: Json | null;
          reason?: string | null;
          request_id?: string;
          ssp_version?: number;
        };
        Relationships: [];
      };
      dtr_entries: {
        Row: {
          break_in: string | null;
          break_out: string | null;
          check_in: string | null;
          check_out: string | null;
          created_at: string;
          entry_date: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          break_in?: string | null;
          break_out?: string | null;
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          entry_date: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          break_in?: string | null;
          break_out?: string | null;
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          entry_date?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"];
          company: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          ojt_title: string | null;
          required_ojt_hours: number | null;
          required_workdays: number | null;
          student_id: string | null;
          updated_at: string;
        };
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"];
          company?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          is_admin?: boolean;
          ojt_title?: string | null;
          required_ojt_hours?: number | null;
          required_workdays?: number | null;
          student_id?: string | null;
          updated_at?: string;
        };
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"];
          company?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          is_admin?: boolean;
          ojt_title?: string | null;
          required_ojt_hours?: number | null;
          required_workdays?: number | null;
          student_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      dtr_admin_set_account_active: {
        Args: { target_active: boolean; target_user_id: string };
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"];
          company: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          ojt_title: string | null;
          required_ojt_hours: number | null;
          required_workdays: number | null;
          student_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dtr_admin_set_required_ojt_hours: {
        Args: { target_hours: number; target_user_id: string };
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"];
          company: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          ojt_title: string | null;
          required_ojt_hours: number | null;
          required_workdays: number | null;
          student_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dtr_admin_update_trainee_profile: {
        Args: {
          expected_updated_at: string;
          new_company: string;
          new_full_name: string;
          new_ojt_title: string;
          new_required_ojt_hours: number | null;
          new_student_id: string;
          target_user_id: string;
        };
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"];
          company: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          ojt_title: string | null;
          required_ojt_hours: number | null;
          required_workdays: number | null;
          student_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dtr_chief_approve: {
        Args: {
          actor_user_id: string;
          credential: string;
          new_password?: string;
          request_id: string;
        };
        Returns: Json;
      };
      dtr_chief_prepare: {
        Args: {
          actor_user_id: string;
          operation: string;
          payload: Json;
          request_id: string;
        };
        Returns: Json;
      };
      dtr_is_active: { Args: never; Returns: boolean };
      dtr_is_admin: { Args: never; Returns: boolean };
      dtr_punch: {
        Args: {
          action: string;
          expected_break_in: string | null;
          expected_break_out: string | null;
          expected_check_in: string | null;
          expected_check_out: string | null;
          expected_date: string;
          expected_id: string | null;
          undo?: boolean;
        };
        Returns: {
          break_in: string | null;
          break_out: string | null;
          check_in: string | null;
          check_out: string | null;
          created_at: string;
          entry_date: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "dtr_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      account_type: "ojt" | "job_order" | "processing" | "regular_employee";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_type: ["ojt", "job_order", "processing", "regular_employee"],
    },
  },
} as const;
