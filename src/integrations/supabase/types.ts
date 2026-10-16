export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      order_items: {
        Row: {
          colour: string
          id: string
          image_key: string | null
          image_url: string | null
          order_id: string
          product_id: string | null
          product_name: string
          product_slug: string
          quantity: number
          size: string
          unit_cost: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          colour: string
          id?: string
          image_key?: string | null
          image_url?: string | null
          order_id: string
          product_id?: string | null
          product_name: string
          product_slug?: string
          quantity: number
          size: string
          unit_cost?: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          colour?: string
          id?: string
          image_key?: string | null
          image_url?: string | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          product_slug?: string
          quantity?: number
          size?: string
          unit_cost?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          admin_note: string | null
          cost_total: number
          created_at: string
          discount: number
          id: string
          order_number: string
          payment_method: string
          payment_status: string
          promo_code: string | null
          ship_address: string
          ship_city: string
          ship_name: string
          ship_phone: string
          ship_pincode: string
          ship_state: string
          shipping: number
          status: string
          subtotal: number
          total: number
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          cost_total?: number
          created_at?: string
          discount?: number
          id?: string
          order_number?: string
          payment_method: string
          payment_status?: string
          promo_code?: string | null
          ship_address: string
          ship_city: string
          ship_name: string
          ship_phone: string
          ship_pincode: string
          ship_state: string
          shipping?: number
          status?: string
          subtotal: number
          total: number
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          cost_total?: number
          created_at?: string
          discount?: number
          id?: string
          order_number?: string
          payment_method?: string
          payment_status?: string
          promo_code?: string | null
          ship_address?: string
          ship_city?: string
          ship_name?: string
          ship_phone?: string
          ship_pincode?: string
          ship_state?: string
          shipping?: number
          status?: string
          subtotal?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      page_views: {
        Row: {
          created_at: string
          device: string | null
          id: number
          path: string
          referrer: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          device?: string | null
          id?: never
          path: string
          referrer?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          device?: string | null
          id?: never
          path?: string
          referrer?: string | null
          session_id?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          colour: string
          colour_hex: string
          id: string
          image_url: string | null
          product_id: string
          size: string
          stock: number
        }
        Insert: {
          colour: string
          colour_hex?: string
          id?: string
          image_url?: string | null
          product_id: string
          size: string
          stock?: number
        }
        Update: {
          colour?: string
          colour_hex?: string
          id?: string
          image_url?: string | null
          product_id?: string
          size?: string
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          badge: string | null
          category: string
          compare_at_price: number | null
          cost_price: number
          created_at: string
          description: string
          details: string
          id: string
          image_key: string | null
          image_url: string | null
          name: string
          price: number
          primary_colour: string
          rating: number
          review_count: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          badge?: string | null
          category?: string
          compare_at_price?: number | null
          cost_price?: number
          created_at?: string
          description?: string
          details?: string
          id?: string
          image_key?: string | null
          image_url?: string | null
          name: string
          price: number
          primary_colour?: string
          rating?: number
          review_count?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          badge?: string | null
          category?: string
          compare_at_price?: number | null
          cost_price?: number
          created_at?: string
          description?: string
          details?: string
          id?: string
          image_key?: string | null
          image_url?: string | null
          name?: string
          price?: number
          primary_colour?: string
          rating?: number
          review_count?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          name: string
          phone: string
        }
        Insert: {
          created_at?: string
          email?: string
          first_name?: string
          id: string
          last_name?: string
          name?: string
          phone?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          name?: string
          phone?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          percent: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          percent: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          percent?: number
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          announcement: string
          cod_enabled: boolean
          free_shipping_threshold: number
          hero_eyebrow: string
          hero_text: string
          hero_title: string
          id: number
          razorpay_enabled: boolean
          shipping_fee: number
          store_name: string
          support_email: string
          updated_at: string
        }
        Insert: {
          announcement?: string
          cod_enabled?: boolean
          free_shipping_threshold?: number
          hero_eyebrow?: string
          hero_text?: string
          hero_title?: string
          id?: number
          razorpay_enabled?: boolean
          shipping_fee?: number
          store_name?: string
          support_email?: string
          updated_at?: string
        }
        Update: {
          announcement?: string
          cod_enabled?: boolean
          free_shipping_threshold?: number
          hero_eyebrow?: string
          hero_text?: string
          hero_title?: string
          id?: number
          razorpay_enabled?: boolean
          shipping_fee?: number
          store_name?: string
          support_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          status: string
          topic: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          status?: string
          topic: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          status?: string
          topic?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_my_order: { Args: { p_order: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      place_order: {
        Args: {
          p_items: Json
          p_payment: string
          p_promo?: string
          p_shipping: Json
        }
        Returns: Json
      }
      validate_promo: { Args: { p_code: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
