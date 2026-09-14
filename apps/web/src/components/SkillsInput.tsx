import { useState, KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';

interface SkillsInputProps {
  value: string[];
  onChange: (skills: string[]) => void;
  /** Suggestions drawn from the skill_categories table. */
  suggestions?: string[];
  max?: number;
  placeholder?: string;
  id?: string;
}

/**
 * Tag-style multi-select. Skills are added with Enter or comma, and can be
 * picked from the suggestions the API returns for the seeded skill categories.
 */
export default function SkillsInput({
  value,
  onChange,
  suggestions = [],
  max = 20,
  placeholder = 'Type a skill and press Enter',
  id,
}: SkillsInputProps) {
  const [draft, setDraft] = useState('');

  const addSkill = (raw: string) => {
    const skill = raw.trim();
    if (!skill) return;
    // Case-insensitive de-dupe so "React" and "react" cannot both be added.
    const exists = value.some((s) => s.toLowerCase() === skill.toLowerCase());
    if (exists || value.length >= max) {
      setDraft('');
      return;
    }
    onChange([...value, skill]);
    setDraft('');
  };

  const removeSkill = (skill: string) => {
    onChange(value.filter((s) => s !== skill));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter would otherwise submit the surrounding form.
      e.preventDefault();
      addSkill(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      removeSkill(value[value.length - 1]);
    }
  };

  const available = suggestions.filter(
    (s) => !value.some((picked) => picked.toLowerCase() === s.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 p-2 focus-within:border-ayira-500 focus-within:ring-1 focus-within:ring-ayira-500">
        {value.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-md bg-ayira-50 px-2 py-1 text-sm text-ayira-700"
          >
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(skill)}
              aria-label={`Remove ${skill}`}
              className="text-ayira-500 hover:text-ayira-800"
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addSkill(draft)}
          placeholder={value.length >= max ? `Maximum ${max} skills` : placeholder}
          disabled={value.length >= max}
          className="min-w-[10rem] flex-1 border-0 p-1 text-sm outline-none disabled:bg-transparent"
        />
      </div>

      {available.length > 0 && value.length < max && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.slice(0, 12).map((skill) => (
            <button
              key={skill}
              type="button"
              onClick={() => addSkill(skill)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-ayira-300 hover:bg-ayira-50 hover:text-ayira-700"
            >
              <Plus size={12} />
              {skill}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
