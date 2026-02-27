export const courseCatalog = [
  {
    id: "course-001",
    title: "Classical Piano Fundamentals",
    imageUrl:
      "https://firebasestorage.googleapis.com/v0/b/piano-learning-system-5fd93.firebasestorage.app/o/course-covers%2FFotolia_87460935_Subscription_Monthly_M.jpg?alt=media&token=a677acd0-c1d9-4f95-953c-fd6fe90c9474",
    level: "Beginner",
    teacher: "Ms. Wang",
    duration: "6 weeks",
    headline:
      "Build solid keyboard technique and music reading skills from day one.",
    description:
      "Step-by-step lessons covering posture, finger independence, scales, and rhythm reading. Perfect for students with little to no formal training.",
    objectives: [
      "Establish healthy hand posture and playing mechanics",
      "Read treble and bass clefs confidently",
      "Perform major scales up to two sharps/flats",
      "Play short recital pieces with musical expression",
    ],
    syllabus: [
      {
        id: "c1-m1",
        weekLabel: "Week 1",
        title: "Posture, hand shape, and keyboard orientation",
        duration: "1.5h live + 2h home practice",
        formats: ["Live lesson", "Technique demo", "Practice assignment"],
        practiceTask:
          "Record 5 minutes of posture drills and C major five-finger warm-up at steady tempo.",
      },
      {
        id: "c1-m2",
        weekLabel: "Week 2-3",
        title: "Reading grand staff and rhythmic coordination",
        duration: "3h live + 4h home practice",
        formats: ["Reading drills", "Worksheet", "Teacher feedback"],
        practiceTask:
          "Complete treble+bass note flashcards and perform two rhythm patterns with metronome.",
      },
      {
        id: "c1-m3",
        weekLabel: "Week 4-5",
        title: "Scale foundations and finger crossing control",
        duration: "3h live + 5h home practice",
        formats: ["Scale training", "Video reference", "Checkpoint quiz"],
        practiceTask:
          "Play C, G, and F major scales hands separately at target tempo without breaks.",
      },
      {
        id: "c1-m4",
        weekLabel: "Week 6",
        title: "Mini performance prep and musical phrasing",
        duration: "1.5h live + 3h home practice",
        formats: ["Mock recital", "Instructor notes", "Final reflection"],
        practiceTask:
          "Submit one full take of your recital piece with dynamics and phrase shaping.",
      },
    ],
    materials: [],
    timeSlots: [
      {
        id: "slot-a",
        label: "Weekdays 18:00 - 19:00",
        dayOfWeek: "Weekdays",
        startTime: "18:00",
        endTime: "19:00",
      },
      {
        id: "slot-b",
        label: "Saturday 10:00 - 11:30",
        dayOfWeek: "Saturday",
        startTime: "10:00",
        endTime: "11:30",
      },
    ],
    tuition: 299,
    quiz: {
      title: "Fundamentals Skills Check",
      description:
        "Gauge your grasp of reading, scales, and technique foundations before the next lesson.",
      questions: [
        {
          id: "c1-q1",
          prompt:
            "Which fingering pattern is standard for a one-octave C major scale, hands together?",
          options: [
            { id: "a", label: "Right hand 12312345, left hand 54321321", isCorrect: true },
            { id: "b", label: "Right hand 1234321, left hand 1234321", isCorrect: false },
            { id: "c", label: "Right hand 11212345, left hand 54321121", isCorrect: false },
            { id: "d", label: "Right hand 12312345, left hand 53421321", isCorrect: false },
          ],
          explanation:
            "In C major, the right hand uses 12312345 while the left uses 54321321 to facilitate smooth thumb crossings.",
        },
        {
          id: "c1-q2",
          prompt: "When reading grand staff, which clef typically shows the left hand part?",
          options: [
            { id: "a", label: "Treble clef", isCorrect: false },
            { id: "b", label: "Bass clef", isCorrect: true },
            { id: "c", label: "Alto clef", isCorrect: false },
            { id: "d", label: "Tenor clef", isCorrect: false },
          ],
          explanation:
            "Piano notation uses treble clef for the right hand and bass clef for the left hand most of the time.",
        },
        {
          id: "c1-q3",
          prompt: "What tempo marking suggests a slow, lyrical character?",
          options: [
            { id: "a", label: "Allegro", isCorrect: false },
            { id: "b", label: "Adagio", isCorrect: true },
            { id: "c", label: "Presto", isCorrect: false },
            { id: "d", label: "Vivace", isCorrect: false },
          ],
          explanation:
            "Adagio indicates a slow tempo, ideal for lyrical phrasing and tone shaping.",
        },
      ],
    },
  },
  {
    id: "course-002",
    title: "Jazz Improvisation Lab",
    imageUrl:
      "https://firebasestorage.googleapis.com/v0/b/piano-learning-system-5fd93.firebasestorage.app/o/course-covers%2Fhq720.jpg?alt=media&token=d1fa5ce8-af86-4a0b-b06e-f3f8c5850390",
    level: "Intermediate",
    teacher: "Mr. Li",
    duration: "8 weeks",
    headline:
      "Unlock swing feel, jazz harmony, and creative soloing vocabulary.",
    description:
      "Jam-focused workshop that dives into blues progressions, ii-V-I lines, comping patterns, and call-and-response techniques. Best suited for players comfortable with major scales and basic chords.",
    objectives: [
      "Internalise 12-bar blues variations in multiple keys",
      "Craft motifs using guide tones and enclosure patterns",
      "Comp effectively behind soloists with shell voicings",
      "Improvise using Mixolydian and bebop scales",
    ],
    syllabus: [
      {
        id: "c2-m1",
        weekLabel: "Week 1-2",
        title: "Swing feel, blues form, and time feel calibration",
        duration: "3h live + 4h home practice",
        formats: ["Play-along lab", "Listening task", "Rhythm drills"],
        practiceTask:
          "Comp through a 12-bar blues in two keys with steady swing pulse and clean chord changes.",
      },
      {
        id: "c2-m2",
        weekLabel: "Week 3-4",
        title: "ii-V-I language and guide-tone targeting",
        duration: "3h live + 5h home practice",
        formats: ["Line construction", "Ear training", "Coach feedback"],
        practiceTask:
          "Create and perform 3 short ii-V-I lines resolving clearly to chord tones.",
      },
      {
        id: "c2-m3",
        weekLabel: "Week 5-6",
        title: "Comping vocabulary with shell and rootless voicings",
        duration: "3h live + 5h home practice",
        formats: ["Voicing workshop", "Backing-track task", "Peer jam"],
        practiceTask:
          "Comp for 2 choruses behind a solo track using shell voicings and dynamic control.",
      },
      {
        id: "c2-m4",
        weekLabel: "Week 7-8",
        title: "Solo storytelling and phrase development",
        duration: "3h live + 6h home practice",
        formats: ["Improvisation lab", "Performance recording", "Final review"],
        practiceTask:
          "Deliver a 2-minute improvised solo with motif development over a jazz standard.",
      },
    ],
    materials: [],
    timeSlots: [
      {
        id: "slot-a",
        label: "Tuesday & Thursday 20:00 - 21:30",
        dayOfWeek: "Tuesday & Thursday",
        startTime: "20:00",
        endTime: "21:30",
      },
      {
        id: "slot-b",
        label: "Sunday 14:00 - 16:00",
        dayOfWeek: "Sunday",
        startTime: "14:00",
        endTime: "16:00",
      },
    ],
    tuition: 389,
    quiz: {
      title: "Jazz Language Pulse Check",
      description:
        "Test your understanding of swing progressions, phrasing, and harmonic targets before the next jam.",
      questions: [
        {
          id: "c2-q1",
          prompt: "What scale is commonly used to improvise over a dominant 7 chord in blues?",
          options: [
            { id: "a", label: "Natural minor scale", isCorrect: false },
            { id: "b", label: "Mixolydian scale", isCorrect: true },
            { id: "c", label: "Harmonic major", isCorrect: false },
            { id: "d", label: "Locrian mode", isCorrect: false },
          ],
          explanation:
            "The Mixolydian mode matches the dominant 7 harmony and keeps chord tones front and centre.",
        },
        {
          id: "c2-q2",
          prompt: "Guide tones in a ii-V-I progression usually move:",
          options: [
            { id: "a", label: "By leap up a fifth", isCorrect: false },
            { id: "b", label: "Chromatically or stepwise to the next chord's 3rd/7th", isCorrect: true },
            { id: "c", label: "Up a whole tone", isCorrect: false },
            { id: "d", label: "Random intervals for variety", isCorrect: false },
          ],
          explanation:
            "Smooth voice-leading keeps the 3rd and 7th of each chord moving by half or whole step, outlining harmony clearly.",
        },
        {
          id: "c2-q3",
          prompt: "A common left-hand comping approach in swing uses:",
          options: [
            { id: "a", label: "Open fifths and octave tremolos", isCorrect: false },
            { id: "b", label: "Shell voicings with 3rd and 7th", isCorrect: true },
            { id: "c", label: "Blocked root-position triads", isCorrect: false },
            { id: "d", label: "Parallel planing chords", isCorrect: false },
          ],
          explanation:
            "Shell voicings (3rd and 7th) leave space for the bassist and clearly express the chord quality.",
        },
      ],
    },
  },
  {
    id: "course-003",
    title: "Exam Prep Intensive",
    imageUrl:
      "https://firebasestorage.googleapis.com/v0/b/piano-learning-system-5fd93.firebasestorage.app/o/course-covers%2Fhq721%20.jpg?alt=media&token=b7968050-b205-416b-958a-30956f436555",
    level: "Advanced",
    teacher: "Ms. Chen",
    duration: "10 weeks",
    headline:
      "Polish repertoire, technical studies, and aural skills for graded exams.",
    description:
      "High-touch coaching focused on ABRSM/Trinity style exam preparation: repertoire refinement, technical drills, sight-reading, and mock juries with detailed feedback.",
    objectives: [
      "Deliver secure performances of required pieces",
      "Demonstrate confident scales/arpeggios up to four sharps/flats",
      "Strengthen sight-reading fluency and clapping accuracy",
      "Practise aural tests and viva voce questions under pressure",
    ],
    syllabus: [
      {
        id: "c3-m1",
        weekLabel: "Week 1-2",
        title: "Diagnostic mock and exam strategy planning",
        duration: "3h live + 4h home practice",
        formats: ["Mock jury", "Rubric review", "Goal planning"],
        practiceTask:
          "Submit baseline recording and map three high-priority fixes for weekly practice.",
      },
      {
        id: "c3-m2",
        weekLabel: "Week 3-5",
        title: "Repertoire refinement and technical reliability",
        duration: "4.5h live + 8h home practice",
        formats: ["Sectional coaching", "Technical drills", "Progress check"],
        practiceTask:
          "Run full repertoire at target tempo and log all recurring accuracy issues.",
      },
      {
        id: "c3-m3",
        weekLabel: "Week 6-8",
        title: "Sight-reading, aural drills, and pressure simulation",
        duration: "4.5h live + 8h home practice",
        formats: ["Timed tests", "Aural session", "Feedback cycle"],
        practiceTask:
          "Complete two timed sight-reading sets and one aural-response worksheet per week.",
      },
      {
        id: "c3-m4",
        weekLabel: "Week 9-10",
        title: "Final mock exam and confidence polishing",
        duration: "3h live + 6h home practice",
        formats: ["Full mock", "Exam etiquette", "Final notes"],
        practiceTask:
          "Perform a complete mock exam program under timing conditions and revise weak spots.",
      },
    ],
    materials: [],
    timeSlots: [
      {
        id: "slot-a",
        label: "Wednesday 19:30 - 21:00",
        dayOfWeek: "Wednesday",
        startTime: "19:30",
        endTime: "21:00",
      },
      {
        id: "slot-b",
        label: "Saturday 13:30 - 15:00",
        dayOfWeek: "Saturday",
        startTime: "13:30",
        endTime: "15:00",
      },
    ],
    tuition: 459,
    quiz: {
      title: "Exam Readiness Snapshot",
      description:
        "Check your recall of exam expectations, technique requirements, and performance prep habits.",
      questions: [
        {
          id: "c3-q1",
          prompt: "During mock juries you should:",
          options: [
            { id: "a", label: "Skip programme introductions to save time", isCorrect: false },
            { id: "b", label: "Practise full walk-on, introductions, and bowing", isCorrect: true },
            { id: "c", label: "Only play technical exercises", isCorrect: false },
            { id: "d", label: "Avoid feedback to reduce nerves", isCorrect: false },
          ],
          explanation:
            "Simulating the complete exam experience builds confidence and stage readiness.",
        },
        {
          id: "c3-q2",
          prompt: "A balanced daily routine for exam prep should include:",
          options: [
            { id: "a", label: "Only repertoire polishing", isCorrect: false },
            { id: "b", label: "Technique drills, repertoire run-throughs, and aural/sight-reading", isCorrect: true },
            { id: "c", label: "Listening to recordings only", isCorrect: false },
            { id: "d", label: "Non-stop slow practice", isCorrect: false },
          ],
          explanation:
            "Balanced preparation keeps technical facility, repertoire security, and aural skills advancing together.",
        },
        {
          id: "c3-q3",
          prompt: "How should you log examiner feedback during lessons?",
          options: [
            { id: "a", label: "Trust memory and move on", isCorrect: false },
            { id: "b", label: "Capture notes in your lesson journal to review before practice", isCorrect: true },
            { id: "c", label: "Ignore comments that sound critical", isCorrect: false },
            { id: "d", label: "Wait until exam day to read comments", isCorrect: false },
          ],
          explanation:
            "Written notes help you convert feedback into actionable practice goals throughout the week.",
        },
      ],
    },
  },
];

export function getCourseById(id) {
  return courseCatalog.find((course) => course.id === id) ?? null;
}
