import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  ChangePasswordRequestSchema,
  ResetPasswordRequestSchema,
  UserListQuerySchema,
  ActivateUserRequestSchema,
  BulkUserOperationSchema,
  InviteUserRequestSchema,
  UpdateProfileRequestSchema,
  UserResponseSchema,
  UserListResponseSchema,
  UserStatsResponseSchema,
  CreateUserRequest,
  UpdateUserRequest,
  ChangePasswordRequest,
  ResetPasswordRequest,
  UserListQuery,
  ActivateUserRequest,
  BulkUserOperation,
  InviteUserRequest,
  UpdateProfileRequest,
  UserError
} from '../../types/user.js';
import { UserRole, Permission } from '../../types/auth.js';
import { userService, UserServiceError } from '../../services/user.service.js';
import { 
  UserValidator, 
  ValidationError,
  handleValidationError 
} from '../../validators/user.validator.js';
import { requireAuth } from '../../middleware/auth.js';
import { hasPermission } from '../../utils/auth.js';
import { logger } from '../../config/logger.js';

/**
 * Standard error response schema
 */
const ErrorResponseSchema = Type.Object({
  error: Type.String({ description: 'Error code' }),
  message: Type.String({ description: 'Error message' }),
  field: Type.Optional(Type.String({ description: 'Field that caused the error' }))
});

/**
 * User ID parameter schema
 */
const UserIdParamSchema = Type.Object({
  id: Type.String({ 
    description: 'User ID',
    minLength: 1
  })
});

/**
 * Register user management routes
 */
export default async function userRoutes(fastify: FastifyInstance) {
  // Use TypeBox type provider
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // Apply authentication middleware to all routes
  await app.register(async function(fastify) {
    fastify.addHook('preHandler', requireAuth);

    /**
     * GET /users - List users with filtering and pagination
     */
    app.get('/users', {
      schema: {
        description: 'List users in the tenant with optional filtering and pagination',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        querystring: UserListQuerySchema,
        response: {
          200: UserListResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        // Validate query parameters
        UserValidator.validateUserListQuery(request);

        const query = request.query as UserListQuery;
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const result = await userService.listUsers(query, tenantId, context);
        
        return reply.code(200).send(result);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users - Create a new user
     */
    app.post('/users', {
      schema: {
        description: 'Create a new user in the tenant',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: CreateUserRequestSchema,
        response: {
          201: UserResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const body = request.body as CreateUserRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        await UserValidator.validateCreateUser(request, tenantId);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.createUser(body, tenantId, context);
        
        return reply.code(201).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * GET /users/:id - Get user by ID
     */
    app.get('/users/:id', {
      schema: {
        description: 'Get user details by ID',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        response: {
          200: UserResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.getUserById(userId, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * PUT /users/:id - Update user
     */
    app.put('/users/:id', {
      schema: {
        description: 'Update user information',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        body: UpdateUserRequestSchema,
        response: {
          200: UserResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const body = request.body as UpdateUserRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        await UserValidator.validateUpdateUser(request, userId, tenantId);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.updateUser(userId, body, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * DELETE /users/:id - Delete user (soft delete)
     */
    app.delete('/users/:id', {
      schema: {
        description: 'Delete user (soft delete)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        response: {
          204: Type.Void(),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        await userService.deleteUser(userId, tenantId, context);
        
        return reply.code(204).send();
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * PUT /users/:id/password - Change user password
     */
    app.put('/users/:id/password', {
      schema: {
        description: 'Change user password',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        body: ChangePasswordRequestSchema,
        response: {
          204: Type.Void(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const body = request.body as ChangePasswordRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        UserValidator.validateChangePassword(request);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        await userService.changePassword(userId, body, tenantId, context);
        
        return reply.code(204).send();
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users/:id/reset-password - Reset user password (admin only)
     */
    app.post('/users/:id/reset-password', {
      schema: {
        description: 'Reset user password (admin only)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        body: ResetPasswordRequestSchema,
        response: {
          204: Type.Void(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const body = request.body as ResetPasswordRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        UserValidator.validateResetPassword(request);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        await userService.resetPassword(userId, body, tenantId, context);
        
        return reply.code(204).send();
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users/:id/activate - Activate/deactivate user
     */
    app.post('/users/:id/activate', {
      schema: {
        description: 'Activate or deactivate user account',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        body: ActivateUserRequestSchema,
        response: {
          200: UserResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const body = request.body as ActivateUserRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        UserValidator.validateActivateUser(request);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.activateUser(userId, body, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users/:id/verify-email - Verify user email
     */
    app.post('/users/:id/verify-email', {
      schema: {
        description: 'Verify user email address',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: UserIdParamSchema,
        response: {
          200: UserResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const { id: userId } = request.params as { id: string };
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.verifyUserEmail(userId, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users/bulk - Perform bulk operations on users
     */
    app.post('/users/bulk', {
      schema: {
        description: 'Perform bulk operations on multiple users',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: BulkUserOperationSchema,
        response: {
          200: Type.Object({
            affected: Type.Number({ description: 'Number of users affected' }),
            errors: Type.Array(Type.String(), { description: 'Any errors that occurred' })
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const body = request.body as BulkUserOperation;
        const tenantId = request.user!.tenant_id;

        // Validate request
        UserValidator.validateBulkUserOperation(request);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const result = await userService.bulkUserOperation(body, tenantId, context);
        
        return reply.code(200).send(result);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * GET /users/stats - Get user statistics
     */
    app.get('/users/stats', {
      schema: {
        description: 'Get user statistics for the tenant',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        response: {
          200: UserStatsResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const stats = await userService.getUserStatistics(tenantId, context);
        
        return reply.code(200).send(stats);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * POST /users/invite - Invite new user
     */
    app.post('/users/invite', {
      schema: {
        description: 'Invite a new user to join the tenant',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: InviteUserRequestSchema,
        response: {
          201: Type.Object({
            message: Type.String({ description: 'Success message' }),
            invitation_id: Type.String({ description: 'Invitation ID for tracking' })
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const body = request.body as InviteUserRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        await UserValidator.validateInviteUser(request, tenantId);

        // TODO: Implement user invitation service
        const invitationId = 'inv_' + Date.now(); // Placeholder

        logger.info('User invitation sent', {
          email: body.email,
          role: body.role,
          tenantId,
          invitedBy: request.user!.id
        });
        
        return reply.code(201).send({
          message: 'Invitation sent successfully',
          invitation_id: invitationId
        });
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * GET /users/me - Get current user profile
     */
    app.get('/users/me', {
      schema: {
        description: 'Get current user profile',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        response: {
          200: UserResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const userId = request.user!.id;
        const tenantId = request.user!.tenant_id;
        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.getUserById(userId, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * PUT /users/me - Update current user profile
     */
    app.put('/users/me', {
      schema: {
        description: 'Update current user profile',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: UpdateProfileRequestSchema,
        response: {
          200: UserResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body as UpdateProfileRequest;
        const tenantId = request.user!.tenant_id;

        // Convert profile update to user update format
        const updateRequest: UpdateUserRequest = {
          first_name: body.first_name,
          last_name: body.last_name,
          phone: body.phone,
          preferences: body.preferences
        };

        // Validate request
        await UserValidator.validateUpdateUser(
          { ...request, body: updateRequest } as FastifyRequest, 
          userId, 
          tenantId
        );

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        const user = await userService.updateUser(userId, updateRequest, tenantId, context);
        
        return reply.code(200).send(user);
      } catch (error) {
        return handleUserError(error, reply);
      }
    });

    /**
     * PUT /users/me/password - Change current user password
     */
    app.put('/users/me/password', {
      schema: {
        description: 'Change current user password',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: ChangePasswordRequestSchema,
        response: {
          204: Type.Void(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    }, async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body as ChangePasswordRequest;
        const tenantId = request.user!.tenant_id;

        // Validate request
        UserValidator.validateChangePassword(request);

        const context = {
          tenantId,
          userId: request.user!.id,
          role: request.user!.role,
          permissions: request.user!.permissions
        };

        await userService.changePassword(userId, body, tenantId, context);
        
        return reply.code(204).send();
      } catch (error) {
        return handleUserError(error, reply);
      }
    });
  });
}

/**
 * Handle user service errors and return appropriate HTTP responses
 */
function handleUserError(error: unknown, reply: FastifyReply) {
  logger.error('User API error', { error });

  if (error instanceof ValidationError) {
    return reply.code(400).send(handleValidationError(error));
  }

  if (error instanceof UserServiceError) {
    switch (error.code) {
      case UserError.USER_NOT_FOUND:
        return reply.code(404).send({
          error: error.code,
          message: error.message
        });

      case UserError.EMAIL_ALREADY_EXISTS:
      case UserError.PHONE_ALREADY_EXISTS:
        return reply.code(409).send({
          error: error.code,
          message: error.message
        });

      case UserError.INSUFFICIENT_PERMISSIONS:
      case UserError.ROLE_PERMISSION_DENIED:
      case UserError.CANNOT_DELETE_SELF:
      case UserError.CANNOT_MODIFY_HIGHER_ROLE:
        return reply.code(403).send({
          error: error.code,
          message: error.message
        });

      case UserError.INVALID_PASSWORD:
      case UserError.PASSWORD_MISMATCH:
      case UserError.ACCOUNT_LOCKED:
      case UserError.ACCOUNT_INACTIVE:
        return reply.code(400).send({
          error: error.code,
          message: error.message
        });

      default:
        return reply.code(500).send({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred'
        });
    }
  }

  // Generic error
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
}