const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } }
        }
      }
    }
  }
};

const profileResponse = {
  description: 'Current user profile',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfileEnvelope' } } }
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Real-Time Chat API',
    version: '0.4.0',
    description: 'REST contract for the Real-Time Chat System. Protected endpoints require a Firebase ID token.'
  },
  servers: [{ url: '/' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'Service is healthy' } }
      }
    },
    '/api/v1/users': {
      get: {
        summary: 'Search the user directory (excludes the caller)',
        description: 'Each word of q must prefix-match a word of the display name. A q containing "@" is an exact email lookup.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }
        ],
        responses: {
          '200': {
            description: 'Matching users',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DirectoryPage' } } }
          },
          '400': errorResponse,
          '401': errorResponse
        }
      }
    },
    '/api/v1/users/{id}': {
      get: {
        summary: 'Get one user by id',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'The user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DirectoryEntryEnvelope' } } }
          },
          '401': errorResponse,
          '404': errorResponse
        }
      }
    },
    '/api/v1/conversations': {
      post: {
        summary: 'Open a direct conversation with another user (idempotent)',
        description: 'Returns 201 when created and 200 when the conversation already existed.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', description: 'Directory user id' } } }
            }
          }
        },
        responses: {
          '200': { description: 'Existing conversation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationEnvelope' } } } },
          '201': { description: 'Created conversation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationEnvelope' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse
        }
      },
      get: {
        summary: "List the caller's conversations, most recent activity first",
        description: "Conversations the caller opened or that already have messages. Someone else's empty conversation stays hidden.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 } }
        ],
        responses: {
          '200': { description: 'Conversations', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationPage' } } } },
          '400': errorResponse,
          '401': errorResponse
        }
      }
    },
    '/api/v1/conversations/{id}': {
      get: {
        summary: 'Get one conversation (participants only; 404 otherwise)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'The conversation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationEnvelope' } } } },
          '401': errorResponse,
          '404': errorResponse
        }
      }
    },
    '/api/v1/me': {
      get: {
        summary: 'Sign in: validate the token, create the profile on first use and return it',
        security: [{ bearerAuth: [] }],
        responses: { '200': profileResponse, '401': errorResponse }
      },
      patch: {
        summary: 'Update the current user profile',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['displayName'],
                properties: { displayName: { type: 'string', minLength: 1, maxLength: 60 } }
              }
            }
          }
        },
        responses: { '200': profileResponse, '400': errorResponse, '401': errorResponse }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' }
    },
    schemas: {
      Profile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firebaseUid: { type: 'string' },
          email: { type: 'string', nullable: true },
          displayName: { type: 'string' },
          photoURL: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      DirectoryEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          photoURL: { type: 'string', nullable: true }
        }
      },
      DirectoryEntryEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/DirectoryEntry' } }
      },
      DirectoryPage: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/DirectoryEntry' } },
          meta: {
            type: 'object',
            properties: { page: { type: 'integer' }, limit: { type: 'integer' }, hasMore: { type: 'boolean' } }
          }
        }
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['direct'] },
          participant: { $ref: '#/components/schemas/DirectoryEntry' },
          lastMessage: {
            type: 'object',
            nullable: true,
            properties: { text: { type: 'string' }, senderId: { type: 'string' }, sentAt: { type: 'string', format: 'date-time' } }
          },
          lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      ConversationEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/Conversation' } }
      },
      ConversationPage: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } },
          meta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, hasMore: { type: 'boolean' } } }
        }
      },
      ProfileEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/Profile' } }
      }
    }
  }
};
