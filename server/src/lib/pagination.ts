import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export function parsePagination(req: Request, defaults: { limit?: number; maxLimit?: number } = {}): PaginationParams {
  const defaultLimit = defaults.limit ?? 20;
  const maxLimit = defaults.maxLimit ?? 100;

  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt((req.query.limit as string) ?? String(defaultLimit), 10) || defaultLimit));

  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(data: T[], totalCount: number, params: PaginationParams): Paginated<T> {
  const totalPages = Math.ceil(totalCount / params.limit);
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      totalCount,
      totalPages,
      hasMore: params.page * params.limit < totalCount,
    },
  };
}
