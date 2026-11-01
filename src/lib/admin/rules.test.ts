import { describe,it,expect } from 'vitest';
import * as rules from './rules';
import { adminRoleAllowed } from './rules';
describe('Admin access',()=>{
 it('does not grant admin access from a hard-coded email address',()=>expect(Object.keys(rules)).not.toContain('adminEmail'));
 it('requires a successful server role result',()=>{expect(adminRoleAllowed(true)).toBe(true);expect(adminRoleAllowed(false)).toBe(false);expect(adminRoleAllowed('admin')).toBe(false);expect(adminRoleAllowed(null)).toBe(false);});
});
