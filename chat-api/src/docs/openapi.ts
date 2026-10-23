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
    version: '0.2.0',
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
      ProfileEnvelope: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/Profile' } }
      }
    }
  }
};
