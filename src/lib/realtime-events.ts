// Typed subset of OpenAI Realtime API events the tutor cares about.
// Full event schema is much larger; we only model what the UI needs.
// Reference: https://platform.openai.com/docs/api-reference/realtime-server-events

export type RealtimeIncomingEvent =
  | { type: 'session.created'; session: { id: string } }
  | { type: 'session.updated' }
  | { type: 'input_audio_buffer.speech_started' }
  | { type: 'input_audio_buffer.speech_stopped' }
  | {
      type: 'conversation.item.input_audio_transcription.completed';
      item_id: string;
      transcript: string;
    }
  | { type: 'response.created' }
  | { type: 'response.output_audio.delta'; delta: string }
  | { type: 'response.output_audio.done' }
  | {
      type: 'response.output_audio_transcript.delta';
      delta: string;
      response_id?: string;
    }
  | {
      type: 'response.output_audio_transcript.done';
      transcript: string;
      response_id?: string;
    }
  | { type: 'response.done'; response: { id: string; status: string } }
  | { type: 'error'; error: { message: string; type?: string; code?: string } };

export type RealtimeOutgoingEvent =
  | {
      type: 'session.update';
      session: {
        instructions?: string;
        voice?: string;
        // Audio format hints. For WebRTC we generally let the SDP negotiation
        // handle codecs, but the API accepts these for clarity.
        input_audio_format?: string;
        output_audio_format?: string;
        input_audio_transcription?: {
          model: string;
          language?: string | null;
        };
        turn_detection?: {
          type: 'server_vad';
          threshold?: number;
          prefix_padding_ms?: number;
          silence_duration_ms?: number;
          create_response?: boolean;
          interrupt_response?: boolean;
        };
      };
    }
  | { type: 'response.cancel' }
  | { type: 'response.create'; response?: { instructions?: string } };

export function isIncomingEvent(value: unknown): value is RealtimeIncomingEvent {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}
