/**
 * Migration: Setup Extensions and Functions
 * Creates necessary PostgreSQL extensions and utility functions
 */

exports.up = pgm => {
  // Create necessary extensions
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  // Create updated_at trigger function
  pgm.createFunction(
    'set_updated_at',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
      replace: true
    },
    `
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
    `
  );
};

exports.down = pgm => {
  // Drop function
  pgm.dropFunction('set_updated_at', []);
  
  // Note: Extensions are not dropped as they might be used by other parts of the system
  // pgm.dropExtension('citext');
  // pgm.dropExtension('pgcrypto');
};