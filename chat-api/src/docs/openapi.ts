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
    version: '0.6.0',
    description:
      'REST contract for the Real-Time Chat System. Protected endpoints require a Firebase ID token. Real-time events (message:send, message:read, message:new, conversation:updated, receipt:update, presence:update, typing:*) are documented in docs/TECHNICAL_DESIGN.md.'
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
    '/api/v1/conversations/{id}/messages': {
      get: {
        summary: 'Message history (newest page by default, returned oldest-first)',
        description: 'Pass `before` (a message id) to fetch the page of older messages.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'before', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 } }
        ],
        responses: {
          '200': { description: 'Messages', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessagePage' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse
        }
      },
      post: {
        summary: 'Send a text message (REST fallback for the message:send socket event)',
        description: 'Idempotent on clientMessageId: 201 when stored, 200 when that id was already stored.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['clientMessageId', 'text'],
                properties: {
                  clientMessageId: { type: 'string', minLength: 8, maxLength: 64, description: 'Sender-generated unique id' },
                  text: { type: 'string', minLength: 1, maxLength: 2000 }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Already stored', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageEnvelope' } } } },
          '201': { description: 'Stored', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageEnvelope' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
          '409': errorResponse
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
          participant: {
            allOf: [{ $ref: '#/components/schemas/DirectoryEntry' }],
            properties: {
              presence: {
                type: 'object',
                nullable: true,
                description: 'Null until the two have exchanged a message.',
                properties: { online: { type: 'boolean' }, lastSeenAt: { type: 'string', format: 'date-time', nullable: true } }
              }
            }
          },
          lastMessage: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string', nullable: true },
              text: { type: 'string' },
              senderId: { type: 'string' },
              sentAt: { type: 'string', format: 'date-time' }
            }
          },
          lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
          unreadCount: { type: 'integer', description: "Caller's unread messages, capped at 100." },
          peerReceipts: {
            type: 'object',
            description: 'Message ids up to which the other person has received / read.',
            properties: { deliveredUpTo: { type: 'string', nullable: true }, readUpTo: { type: 'string', nullable: true } }
          },
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
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          conversationId: { type: 'string' },
          senderId: { type: 'string' },
          clientMessageId: { type: 'string' },
          text: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      MessageEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/Message' } }
      },
      MessagePage: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
          meta: { type: 'object', properties: { limit: { type: 'integer' }, hasMore: { type: 'boolean' } } }
        }
      },
      ProfileEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/Profile' } }
      }
    }
  }
};
