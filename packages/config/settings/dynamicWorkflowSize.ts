import { z } from 'zod/v4'

export const DynamicWorkflowSizeSchema = z
  .enum(['small', 'medium', 'large'])
  .optional()
  .describe('Advisory size for dynamically generated workflows')
