export type CallStatus =
  | 'pending'
  | 'downloading'
  | 'transcribing'
  | 'analyzing'
  | 'complete'
  | 'failed'

export type JobType = 'download' | 'transcribe' | 'analyze'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Call {
  id: string
  ringba_call_id: string
  received_at: string
  call_started_at: string | null
  duration_seconds: number | null
  caller_id: string | null
  target_number: string | null
  campaign_name: string | null
  buyer_name: string | null
  publisher_name: string | null
  revenue: number | null
  payout: number | null
  recording_url_original: string | null
  recording_storage_path: string | null
  transcript: Json | null
  transcript_text: string | null
  analysis: Json | null
  quality_score: number | null
  flags: string[] | null
  status: CallStatus
  error_message: string | null
  processing_attempts: number
  created_at: string
  updated_at: string
}

export interface WebhookEvent {
  id: string
  received_at: string
  payload: Json
  signature_valid: boolean | null
  processed: boolean
}

export interface ProcessingJob {
  id: string
  call_id: string
  job_type: JobType
  status: JobStatus
  attempts: number
  last_error: string | null
  scheduled_for: string
  created_at: string
}

export interface ApiLog {
  id: string
  call_id: string | null
  service: 'groq_whisper' | 'groq_llm'
  request_duration_ms: number
  tokens_used: number | null
  status_code: number
  error: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      calls: {
        Row: Call
        Insert: Omit<Call, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Call, 'id' | 'created_at'>>
        Relationships: []
      }
      webhook_events: {
        Row: WebhookEvent
        Insert: Omit<WebhookEvent, 'id'>
        Update: Partial<Omit<WebhookEvent, 'id'>>
        Relationships: []
      }
      processing_jobs: {
        Row: ProcessingJob
        Insert: Omit<ProcessingJob, 'id' | 'created_at'>
        Update: Partial<Omit<ProcessingJob, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'processing_jobs_call_id_fkey'
            columns: ['call_id']
            isOneToOne: false
            referencedRelation: 'calls'
            referencedColumns: ['id']
          }
        ]
      }
      api_logs: {
        Row: ApiLog
        Insert: Omit<ApiLog, 'id' | 'created_at'>
        Update: Partial<Omit<ApiLog, 'id'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
