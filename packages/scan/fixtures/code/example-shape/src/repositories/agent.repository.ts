export interface ActiveToolRow {
  name: string;
  is_active: boolean;
}

export const agentRepository = {
  async getActiveTools(locationId: number): Promise<ActiveToolRow[]> {
    // Stands for a database query: which tools are enabled for this location.
    return locationId > 0 ? [{ name: 'get_property', is_active: true }] : [];
  },
};
