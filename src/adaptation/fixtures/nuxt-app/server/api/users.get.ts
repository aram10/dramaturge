export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  if (!session) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }
  return [];
});
