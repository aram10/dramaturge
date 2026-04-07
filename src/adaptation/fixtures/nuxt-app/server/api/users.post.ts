export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  if (!session) {
    throw createError({ statusCode: 403, message: 'Forbidden' });
  }
  const body = UserSchema.parse(await readBody(event));
  setResponseStatus(event, 201);
  return { id: 1 };
});
