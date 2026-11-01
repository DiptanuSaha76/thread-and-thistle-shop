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
      customer_carts: {
        Row: {
          items: Json
          promo_code: string | null
          updated_at: string
          user_id: string
          wishlist: Json
        }
        Insert: {
          items?: Json
          promo_code?: string | null
          updated_at?: string
          user_id: string
          wishlist?: Json
        }
        Update: {
          items?: Json
          promo_code?: string | null
          updated_at?: string
          user_id?: string
          wishlist?: Json
        }
        Relationships: []
      }
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
      order_shipments: {
        Row: {
          awb: string
          created_at: string
          estimated_delivery: string | null
          current_status: string | null
          events: Json
          last_attempt_at: string | null
          last_result: string | null
          last_synced_at: string | null
          order_id: string
          provider: string
          track_url: string | null
          updated_at: string
        }
        Insert: {
          awb: string
          created_at?: string
          estimated_delivery?: string | null
          current_status?: string | null
          events?: Json
          last_attempt_at?: string | null
          last_result?: string | null
          last_synced_at?: string | null
          order_id: string
          provider?: string
          track_url?: string | null
          updated_at?: string
        }
        Update: {
          awb?: string
          created_at?: string
          estimated_delivery?: string | null
          current_status?: string | null
          events?: Json
          last_attempt_at?: string | null
          last_result?: string | null
          last_synced_at?: string | null
          order_id?: string
          provider?: string
          track_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          order_id: string
          provider: string
          provider_order_id: string
          provider_payment_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          order_id: string
          provider: string
          provider_order_id: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          provider?: string
          provider_order_id?: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
          idempotency_key: string | null
          order_number: string
          payment_method: string
          payment_status: string
          promo_code: string | null
          ship_address: string
          delivered_at: string | null
          shipped_at: string | null
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
          idempotency_key?: string | null
          order_number?: string
          payment_method: string
          payment_status?: string
          promo_code?: string | null
          ship_address: string
          delivered_at?: string | null
          shipped_at?: string | null
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
          idempotency_key?: string | null
          order_number?: string
          payment_method?: string
          payment_status?: string
          promo_code?: string | null
          ship_address?: string
          delivered_at?: string | null
          shipped_at?: string | null
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
      payment_refunds: {
        Row: {
          amount: number
          attempts: number
          created_at: string
          currency: string
          id: string
          last_error: string | null
          note: string | null
          order_id: string
          payment_record_id: string | null
          provider: string
          provider_payment_id: string
          provider_refund_id: string | null
          provider_status: string | null
          reason: string
          requested_at: string | null
          requested_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          attempts?: number
          created_at?: string
          currency?: string
          id?: string
          last_error?: string | null
          note?: string | null
          order_id: string
          payment_record_id?: string | null
          provider?: string
          provider_payment_id: string
          provider_refund_id?: string | null
          provider_status?: string | null
          reason: string
          requested_at?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          attempts?: number
          created_at?: string
          currency?: string
          id?: string
          last_error?: string | null
          note?: string | null
          order_id?: string
          payment_record_id?: string | null
          provider?: string
          provider_payment_id?: string
          provider_refund_id?: string | null
          provider_status?: string | null
          reason?: string
          requested_at?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verification_challenges: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          ip_hash: string | null
          otp_hash: string
          phone: string
          phone_country: string
          sent_at: string | null
          status: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id: string
          ip_hash?: string | null
          otp_hash: string
          phone: string
          phone_country: string
          sent_at?: string | null
          status?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          otp_hash?: string
          phone?: string
          phone_country?: string
          sent_at?: string | null
          status?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      product_reviews: {
        Row: {
          body: string
          created_at: string
          display_name: string
          id: string
          product_id: string
          rating: number
          status: string
          title: string
          updated_at: string
          user_id: string
          verified_purchase: boolean
        }
        Insert: {
          body: string
          created_at?: string
          display_name: string
          id?: string
          product_id: string
          rating: number
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          verified_purchase?: boolean
        }
        Update: {
          body?: string
          created_at?: string
          display_name?: string
          id?: string
          product_id?: string
          rating?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          verified_purchase?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
          images: string[]
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
          images?: string[]
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
          images?: string[]
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
          phone_country: string
          phone_verified_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          first_name?: string
          id: string
          last_name?: string
          name?: string
          phone?: string
          phone_country?: string
          phone_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          name?: string
          phone?: string
          phone_country?: string
          phone_verified_at?: string | null
          updated_at?: string
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
          categories: string[]
          cod_enabled: boolean
          colours: Json
          filters: string[]
          free_shipping_threshold: number
          hero_eyebrow: string
          hero_text: string
          hero_title: string
          id: number
          price_max: number
          price_min: number
          razorpay_enabled: boolean
          shipping_fee: number
          sizes: string[]
          store_name: string
          support_email: string
          updated_at: string
        }
        Insert: {
          announcement?: string
          categories?: string[]
          cod_enabled?: boolean
          colours?: Json
          filters?: string[]
          free_shipping_threshold?: number
          hero_eyebrow?: string
          hero_text?: string
          hero_title?: string
          id?: number
          price_max?: number
          price_min?: number
          razorpay_enabled?: boolean
          shipping_fee?: number
          sizes?: string[]
          store_name?: string
          support_email?: string
          updated_at?: string
        }
        Update: {
          announcement?: string
          categories?: string[]
          cod_enabled?: boolean
          colours?: Json
          filters?: string[]
          free_shipping_threshold?: number
          hero_eyebrow?: string
          hero_text?: string
          hero_title?: string
          id?: number
          price_max?: number
          price_min?: number
          razorpay_enabled?: boolean
          shipping_fee?: number
          sizes?: string[]
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
          ip_hash: string | null
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
          ip_hash?: string | null
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
          ip_hash?: string | null
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
      yearth_account_preferences: {
        Row: {
          newsletter: boolean
          order_updates: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          newsletter?: boolean
          order_updates?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          newsletter?: boolean
          order_updates?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      yearth_addresses: {
        Row: {
          city: string
          created_at: string
          full_name: string
          id: string
          is_default: boolean
          label: string
          line1: string
          line2: string | null
          phone: string
          pincode: string
          state: string
          user_id: string
        }
        Insert: {
          city: string
          created_at?: string
          full_name: string
          id?: string
          is_default?: boolean
          label?: string
          line1: string
          line2?: string | null
          phone: string
          pincode: string
          state: string
          user_id: string
        }
        Update: {
          city?: string
          created_at?: string
          full_name?: string
          id?: string
          is_default?: boolean
          label?: string
          line1?: string
          line2?: string | null
          phone?: string
          pincode?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      yearth_profiles: {
        Row: {
          full_name: string | null
          phone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          full_name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          full_name?: string | null
          phone?: string | null
          updated_at?: string | null
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
      cancel_order: { Args: { p_order: string }; Returns: undefined }
      check_promo_code: { Args: { p_code: string }; Returns: number | null }
      check_signup_email: { Args: { p_email: string }; Returns: string }
      can_review_product: {
        Args: { p_product: string }
        Returns: boolean
      }
      create_order: {
        Args: {
          p_idempotency_key?: string
          p_items: Json
          p_payment: string
          p_promo?: string
          p_shipping: Json
        }
        Returns: Json
      }
      ensure_my_profile: { Args: never; Returns: undefined }
      expire_unpaid_orders: { Args: { p_minutes?: number }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      mark_order_paid: {
        Args: {
          p_amount: number
          p_provider_order_id: string
          p_provider_payment_id: string
        }
        Returns: string
      }
      mark_payment_failed: {
        Args: { p_provider_order_id: string; p_provider_payment_id: string }
        Returns: undefined
      }
      phone_otp_begin: {
        Args: {
          p_challenge: string
          p_ip_hash?: string | null
          p_otp_hash: string
          p_phone: string
          p_user: string
        }
        Returns: Json
      }
      phone_otp_mark_sent: {
        Args: { p_challenge: string; p_sent: boolean }
        Returns: undefined
      }
      phone_otp_status: {
        Args: { p_user: string }
        Returns: Json
      }
      phone_otp_verify: {
        Args: { p_otp_hash: string; p_user: string }
        Returns: Json
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
      record_payment_order: {
        Args: {
          p_amount: number
          p_order: string
          p_provider_order_id: string
          p_user: string
        }
        Returns: undefined
      }
      refund_begin: {
        Args: { p_admin: string; p_case: string }
        Returns: Json
      }
      refund_mark_failed: {
        Args: { p_case: string; p_error: string }
        Returns: undefined
      }
      refund_record: {
        Args: {
          p_admin: string
          p_amount: number
          p_case: string
          p_provider_status: string
          p_refund_id: string
        }
        Returns: string
      }
      refund_resolve_manually: {
        Args: { p_admin: string; p_case: string; p_note: string }
        Returns: string
      }
      save_my_profile: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_name?: string
          p_phone?: string
          p_phone_country?: string
        }
        Returns: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          name: string
          phone: string
          phone_country: string
          phone_verified_at: string | null
          updated_at: string
        }
      }
      set_default_address: { Args: { p_address: string }; Returns: undefined }
      submit_product_review: {
        Args: { p_body: string; p_product: string; p_rating: number; p_title: string }
        Returns: Json
      }
      submit_support_message: {
        Args: {
          p_email: string
          p_ip_hash: string | null
          p_message: string
          p_name: string
          p_topic: string
          p_user: string | null
        }
        Returns: string
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
