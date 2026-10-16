import { describe,it,expect } from 'vitest';
import { adminEmail,adminRoleAllowed } from './rules';
describe('Admin access',()=>{
 it('uses the administrator selected by the owner',()=>expect(adminEmail).toBe('diptanusaha54@gmail.com'));
 it('requires a successful server role result',()=>{expect(adminRoleAllowed(true)).toBe(true);expect(adminRoleAllowed(false)).toBe(false);expect(adminRoleAllowed('admin')).toBe(false);expect(adminRoleAllowed(null)).toBe(false);});
});
