import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';

const controlLight: FunctionDeclaration = {
  name: 'control_light',
  description: 'Set brightness and colour temperature.',
  parametersJsonSchema: { type: 'object', properties: { brightness: { type: 'number' }, colorTemperature: { type: 'string' } } },
};

export async function run(ai: GoogleGenAI, contents: string): Promise<void> {
  await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      tools: [
        { functionDeclarations: [controlLight, { name: 'set_thermostat', description: 'Set the thermostat.', parametersJsonSchema: { type: 'object', properties: { celsius: { type: 'number' } } } }] },
        { googleSearch: {} },
      ],
    },
  });
}
