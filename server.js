// server.js - OpenAI to NVIDIA NIM API Proxy (DUAL MODEL ENABLED)

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🔥 Dual model config
const PRIMARY_MODEL = 'z-ai/glm5'; // modelo principal (rápido/coherente)
const FORMAT_MODEL = 'z-ai/glm4.7'; // modelo que arregla formato
const ENABLE_DUAL_MODEL = true;

// Toggles
const SHOW_REASONING = false;
const ENABLE_THINKING_MODE = false;

// Model mapping (fallback si desactivás dual)
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'moonshotai/kimi-k2.5',
  'gpt-4-turbo': 'z-ai/glm5',
  'gpt-4o': 'z-ai/glm4.7',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking' 
};

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    dual_model: ENABLE_DUAL_MODEL,
    primary: PRIMARY_MODEL,
    formatter: FORMAT_MODEL
  });
});

// Models list
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));

  res.json({
    object: 'list',
    data: models
  });
});

// Chat endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Elegir modelo
    let nimModel = ENABLE_DUAL_MODEL ? PRIMARY_MODEL : MODEL_MAPPING[model];

    // Request base
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: ENABLE_DUAL_MODEL ? false : (stream || false)
    };

    // 🔥 Primera llamada (modelo principal)
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let generatedText = response.data?.choices?.[0]?.message?.content || '';
    let finalText = generatedText;

    // 🔥 Segunda llamada (formateo)
    if (ENABLE_DUAL_MODEL && generatedText) {
      try {
        const formatPrompt = `Reescribe el siguiente texto sin cambiar su contenido ni significado.

Reglas:
- separar correctamente en párrafos
- usar saltos de línea dobles
- mejorar legibilidad
- NO agregar ni quitar información

Texto:
${generatedText}`;

        const formatResponse = await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: FORMAT_MODEL,
          messages: [{ role: 'user', content: formatPrompt }],
          temperature: 0.3,
          max_tokens: max_tokens || 9024
        }, {
          headers: {
            'Authorization': `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        finalText = formatResponse.data?.choices?.[0]?.message?.content || generatedText;
      } catch (err) {
        console.error('Formatting error:', err.message);
        finalText = generatedText;
      }
    }

    // Respuesta tipo OpenAI
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: finalText
          },
          finish_reason: 'stop'
        }
      ],
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };

    res.json(openaiResponse);

  } catch (error) {
    console.error('Proxy error:', error.message);

    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy running on port ${PORT}`);
  console.log(`🔥 Dual model: ${ENABLE_DUAL_MODEL ? 'ON' : 'OFF'}`);
});
```
