const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ludra API',
      version: '1.0.0',
      description: 'API REST pour la plateforme de recherche de logement Ludra au Cameroun',
      contact: {
        name: 'Ludra Team',
        email: 'contact@ludra.cm',
      },
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5000}/api`,
        description: 'Serveur de développement',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Entrer le token JWT : Bearer <token>',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', example: '+237612345678' },
            city: { type: 'string' },
            role: { type: 'string', enum: ['user', 'landlord', 'admin'] },
            avatar: { type: 'string' },
            emailVerified: { type: 'boolean' },
            phoneVerified: { type: 'boolean' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Property: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            type: { type: 'string', enum: ['apartment', 'studio', 'house', 'room', 'loft'] },
            price: { type: 'number', description: 'Prix en FCFA/mois' },
            location: { type: 'string', enum: ['douala', 'yaounde', 'bafoussam', 'garoua', 'ngaoundere', 'limbe', 'kribi', 'bamenda'] },
            status: { type: 'string', enum: ['available', 'occupied', 'pending'] },
            rating: { type: 'number' },
            image: { type: 'string' },
            images: { type: 'array', items: { type: 'string' } },
            beds: { type: 'integer' },
            baths: { type: 'integer' },
            area: { type: 'number', description: 'Surface en m²' },
            featured: { type: 'boolean' },
            description: { type: 'string' },
            address: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            amenities: { type: 'array', items: { type: 'string' } },
            landlordId: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            propertyId: { type: 'string' },
            userId: { type: 'string' },
            landlordId: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            message: { type: 'string' },
            isRead: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Visit: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            propertyId: { type: 'string' },
            userId: { type: 'string' },
            landlordId: { type: 'string' },
            preferredDate: { type: 'string', format: 'date-time' },
            message: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'rejected', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentification et gestion de session' },
      { name: 'Users', description: 'Gestion des utilisateurs' },
      { name: 'Properties', description: 'Gestion des propriétés' },
      { name: 'Favorites', description: 'Favoris des utilisateurs' },
      { name: 'Contacts', description: 'Demandes de contact propriétaire' },
      { name: 'Visits', description: 'Planification de visites' },
      { name: 'Admin', description: 'Administration de la plateforme' },
      { name: 'Landlord', description: 'Espace propriétaire' },
      { name: 'Notifications', description: 'Notifications in-app des utilisateurs' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
