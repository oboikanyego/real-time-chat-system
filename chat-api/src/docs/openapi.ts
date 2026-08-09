export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Real-Time Chat API',
    version: '0.1.0',
    description: 'Initial API contract and health endpoint for the Real-Time Chat System.'
  },
  servers: [{ url: '/' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': { description: 'Service is healthy' }
        }
      }
    },
    '/api/v1/me': {
      get: {
        summary: 'Return the authenticated development identity (foundation endpoint)',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Current identity' },
          '401': { description: 'Unauthenticated' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' }
    }
  }
};
